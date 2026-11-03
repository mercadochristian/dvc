import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { configured, db, guard, guest, identity, logFailure, ORG, rpc } from '@/lib/club/server'
import { assertSameOrigin, ClubError, dateWindow, limitedBody, record, text, uuid, validateAction, validateHold } from '@/lib/club/validation'
import { requireAction, requireStaff } from '@/lib/club/permissions'

export const dynamic = 'force-dynamic'
function result(value: unknown) { return NextResponse.json(value, { headers: { 'Cache-Control': 'private, no-store' } }) }
export async function GET(request: Request) {
  const reference = randomUUID(); let actor: string | null = null
  const q = new URL(request.url).searchParams, view = q.get('view') || 'schedule'
  try {
    if (view === 'session' && !configured()) return result({ configured: false, user: null, role: 'player', developer: false })
    if (view === 'schedule') {
      const { start, end } = dateWindow(q.get('from'), q.get('to'))
      return result(await rpc('dvc_schedule', { p_org: ORG, p_from: start, p_to: end }))
    }
    if (view === 'roster') return result(await rpc('dvc_roster', { p_org: ORG, p_game: uuid(q.get('game')) }))
    if (view === 'methods') return result(await db(`payment_methods?organization_id=eq.${ORG}&enabled=eq.true&select=id,label,account_name,account_number,qr_path,enabled&order=label`))
    const auth = await identity(); actor = auth.user?.id || null
    if (view === 'session') return result({ configured: true, user: auth.user ? { id: auth.user.id, email: auth.user.email || '', name: auth.user.user_metadata?.full_name || auth.user.email || 'Player' } : null, role: auth.role, developer: auth.developer })
    if (view === 'mine') return result(await rpc('dvc_bookings', { p_org: ORG, p_user: actor, p_guest: await guest() }))
    if (view === 'workspace') { requireStaff(auth.role); return result(await rpc('dvc_workspace', { p_org: ORG, p_user: actor })) }
    if (view === 'logs') {
      if (!auth.developer) throw new ClubError('Developer access required', 403, 'ACCESS_DENIED')
      const kind = q.get('kind'); if (kind && !['activity', 'error'].includes(kind)) throw new ClubError('Invalid log filter')
      const ref = q.get('reference'), cursor = q.get('before')
      let cursorFilter = ''
      if (cursor) {
        const [time, id, extra] = cursor.split('|')
        if (extra || !time || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(time) || !Number.isFinite(Date.parse(time))) throw new ClubError('Invalid log cursor')
        const stamp = time, key = uuid(id)
        cursorFilter = `&or=${encodeURIComponent(`(created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${key}))`)}`
      }
      return result(await db(`developer_events?organization_id=eq.${ORG}&select=*&order=created_at.desc,id.desc&limit=100${kind ? `&kind=eq.${kind}` : ''}${ref ? `&reference_id=eq.${uuid(ref)}` : ''}${cursorFilter}`))
    }
    throw new ClubError('Page not found', 404)
  } catch (error) {
    const e = error instanceof ClubError ? error : new ClubError('Could not load data. Try again', 500, 'UNEXPECTED_ERROR')
    if (e.code !== 'SETUP_REQUIRED') await logFailure(reference, `read.${['session','schedule','roster','methods','mine','workspace','logs'].includes(view) ? view : 'unknown'}`, e.code, actor)
    return NextResponse.json({ error: e.message, reference }, { status: e.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
export async function POST(request: Request) {
  const reference = randomUUID(); let actor: string | null = null, action = 'unknown'
  try {
    assertSameOrigin(request)
    await guard(request, 'write')
    if (Number(request.headers.get('content-length') || 0) > 20000) throw new ClubError('Request is too large', 413)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(await limitedBody(request, 20000))) }
    catch (error) { if (error instanceof ClubError) throw error; throw new ClubError('Invalid request body') }
    const body = record(parsed)
    action = text(body.action, 'action', 1, 40)
    const auth = await identity(); actor = auth.user?.id || null
    if (action === 'booking.hold') {
      const data = validateHold(body.data)
      const booking = await rpc('dvc_hold', { p_org: ORG, p_user: actor, p_guest: actor ? null : await guest(true), p_data: data, p_ref: reference })
      return result({ booking, reference })
    }
    const data = validateAction(action, body.data)
    requireAction(auth.role, action)
    if (action === 'access.save' && data.role === 'developer' && auth.role !== 'developer') throw new ClubError('Developer access required', 403, 'ACCESS_DENIED')
    const id = await rpc('dvc_admin', { p_org: ORG, p_user: actor, p_action: action, p_data: data, p_ref: reference })
    return result({ id, reference })
  } catch (error) {
    const e = error instanceof ClubError ? error : new ClubError('Could not save. Try again', 500, 'UNEXPECTED_ERROR')
    await logFailure(reference, ['booking.hold','manual.register','game.save','game.cancel','roster.update','booking.cancel','booking.transfer','receipt.approve','receipt.reject','payment.save','access.save','venue.save','venue.delete','faci.self','faci.assign','booking.details'].includes(action) ? action : 'unknown', e.code, actor)
    return NextResponse.json({ error: e.message, reference }, { status: e.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
