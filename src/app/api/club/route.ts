import { deliverGameNotices, gameNoticeDeliveryConfigured } from '@/features/club/server/game-notices'
import { randomUUID } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { configured, db, guard, guest, identity, logFailure, ORG, rpc } from '@/features/club/server/gateway'
import { assertSameOrigin, limitedBody } from '@/features/club/server/http'
import { readCheckout, type CheckoutHoldResult } from '@/features/club/server/checkout'
import { ClubError, dateWindow, record, text, uuid, validateAction, validateCheckoutDraft, validateCheckoutHoldDraft, validateBookingPlayerUpdate } from '@/features/club/model/validation'
import { readManagementPayments } from '@/features/club/server/management-payments'
import { saveManagementSkill } from '@/features/club/server/management-skill'
import { readStaffGames } from '@/features/club/server/staff-games'
import { readManagementUsers } from '@/features/club/server/management-users'
import { verifyPaymentQrProof } from '@/features/club/server/payment-qr-proof'
import { readManagementOptions } from '@/features/club/server/management-options'
import { requireAction, requireStaff } from '@/features/club/model/permissions'
import { DEVELOPER_LOG_PAGE_SIZE, type DeveloperEvent, type DeveloperLogPage } from '@/features/club/model/types'

import { parseBrowse, encodeBrowseCursor, selectedGameIds, type BrowseRpcPage } from '@/features/club/model/browse-validation'

export const dynamic = 'force-dynamic'
function result(value: unknown) { return NextResponse.json(value, { headers: { 'Cache-Control': 'private, no-store' } }) }
export async function GET(request: Request) {
  const reference = randomUUID(); let actor: string | null = null
  const q = new URL(request.url).searchParams, view = q.get('view') || 'schedule'
  try {
    if (view === 'session' && !configured()) return result({ configured: false, user: null, role: 'player', developer: false })
    if (view === 'games') {
      const { filters, scope, anchor, cursor } = parseBrowse(q)
      const page = await rpc<BrowseRpcPage>('dvc_games_browse', { p_org: ORG, p_anchor: anchor, p_date: filters.date, p_venue: filters.venue, p_completed: filters.completed, p_cancelled: filters.cancelled, p_query: filters.query, p_position: filters.position, p_after_bucket: cursor?.bucket ?? null, p_after_start: cursor?.starts_at ?? null, p_after_id: cursor?.id ?? null })
      return result({ games: page.games, as_of: anchor, next_cursor: page.next_key ? encodeBrowseCursor(scope, anchor, page.next_key) : null })
    }
    if (view === 'game-venues') {
      if (q.getAll('after').length > 1) throw new ClubError('Duplicate venue cursor')
      return result(await rpc('dvc_game_venues', { p_org: ORG, p_after: q.get('after') ? uuid(q.get('after')).toLowerCase() : null }))
    }
    if (view === 'selected-games') return result(await rpc('dvc_selected_games', { p_org: ORG, p_ids: selectedGameIds(q) }))
    if (view === 'schedule') {
      const { start, end } = dateWindow(q.get('from'), q.get('to'))
      return result(await rpc('dvc_schedule', { p_org: ORG, p_from: start, p_to: end }))
    }
    if (view === 'announcements') return result(await rpc('dvc_announcements', { p_org: ORG }))
    if (view === 'roster') return result(await rpc('dvc_roster', { p_org: ORG, p_game: uuid(q.get('game')) }))
    if (view === 'methods') return result(await db(`payment_methods?organization_id=eq.${ORG}&enabled=eq.true&select=id,label,account_name,account_number,qr_path,enabled&order=label`))
    const auth = await identity(); actor = auth.user?.id || null
    if (view === 'session') {
      const user = auth.user
      if (!user) return result({ configured: true, user: null, role: auth.role, developer: auth.developer })
      const [profile] = await db<{ name: string }[]>(`player_profiles?select=name&organization_id=eq.${encodeURIComponent(ORG)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`)
      const name = profile?.name.trim() || user.user_metadata?.full_name?.trim() || 'Player'
      return result({ configured: true, user: { id: user.id, email: user.email || '', name }, role: auth.role, developer: auth.developer })
    }
    if (view === 'profile') return result(actor ? await rpc('dvc_profile', { p_org: ORG, p_user: actor }) : null)
    if (view === 'checkout') return result(await readCheckout(actor, actor ? null : await guest(), uuid(q.get('id'))))
    if (view === 'mine') return result(await rpc('dvc_bookings', { p_org: ORG, p_user: actor, p_guest: await guest() }))
    if (view === 'management-payments') return result(await readManagementPayments(q, auth.role, actor))
    if (view === 'staff-games' || view === 'staff-game-context') return result(await readStaffGames(q, auth.role, actor))
    if (view === 'management-users') return result(await readManagementUsers(q, auth.role, actor))
    if (['staff-game-venues', 'management-venues', 'management-methods', 'management-announcements', 'management-destinations'].includes(view)) {
      return result(await readManagementOptions(view, auth.role, actor, q))
    }
    if (view === 'workspace') {
      requireStaff(auth.role)
      const workspace = await rpc<Record<string, unknown>>('dvc_workspace', { p_org: ORG, p_user: actor })
      const { users: _users, access: _access, ...gameWorkspace } = workspace
      return result(gameWorkspace)
    }
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
      const paged = q.get('pagination') === 'cursor'
      const limit = DEVELOPER_LOG_PAGE_SIZE + (paged ? 1 : 0)
      const rows = await db<DeveloperEvent[]>(`developer_events?organization_id=eq.${ORG}&select=*&order=created_at.desc,id.desc&limit=${limit}${kind ? `&kind=eq.${kind}` : ''}${ref ? `&reference_id=eq.${uuid(ref)}` : ''}${cursorFilter}`)
      if (!paged) return result(rows)
      const events = rows.slice(0, DEVELOPER_LOG_PAGE_SIZE)
      const last = events.at(-1)
      return result({ events, next_cursor: rows.length > DEVELOPER_LOG_PAGE_SIZE && last ? `${last.created_at}|${last.id}` : null } satisfies DeveloperLogPage)
    }
    throw new ClubError('Page not found', 404)
  } catch (error) {
    const e = error instanceof ClubError ? error : new ClubError('Could not load data. Try again', 500, 'UNEXPECTED_ERROR')
    if (e.code !== 'SETUP_REQUIRED') await logFailure(reference, `read.${['session','schedule','games','game-venues','selected-games','roster','methods','mine','workspace','management-users','staff-games','staff-game-context','staff-game-venues','management-payments','management-venues','management-methods','management-announcements','management-destinations','logs','announcements','profile','checkout'].includes(view) ? view : 'unknown'}`, e.code, actor)
    return NextResponse.json({ error: e.message, code: e.code, reference }, { status: e.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
export async function POST(request: Request) {
  const reference = randomUUID(); let actor: string | null = null, action = 'unknown'
  try {
    assertSameOrigin(request)
    await guard(request, 'write')
    if (Number(request.headers.get('content-length') || 0) > 100000) throw new ClubError('Request is too large', 413)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(await limitedBody(request, 100000))) }
    catch (error) { if (error instanceof ClubError) throw error; throw new ClubError('Invalid request body') }
    const body = record(parsed)
    action = text(body.action, 'action', 1, 40)
    const auth = await identity(); actor = auth.user?.id || null
    if (action === 'guest.bootstrap') {
      if (!actor) await guest(true)
      return result({ ready: true, reference })
    }
    if (action === 'checkout.review') {
      if (!actor && !await guest()) throw new ClubError('Prepare your guest session before reviewing games', 409, 'CHECKOUT_SESSION_REQUIRED')
      const data = validateCheckoutDraft(body.data)
      const checkout = await rpc('dvc_checkout_review', { p_org: ORG, p_data: data })
      return result({ checkout, reference })
    }
    if (action === 'booking.hold') throw new ClubError('Registration has changed. Refresh the page and review your games', 409, 'LEGACY_REGISTRATION_RETIRED')
    if (action === 'checkout.hold') {
      // Permit only legacy transport shape here so an already-owned request can
      // return its original checkout. The RPC's new-request review is strict.
      const data = validateCheckoutHoldDraft(body.data)
      const guestHash = actor ? null : await guest()
      if (!actor && !guestHash) {
        throw new ClubError('Review your games again before confirming your slots', 409, 'CHECKOUT_REVIEW_REQUIRED')
      }
      const held = await rpc<CheckoutHoldResult>('dvc_checkout_hold', { p_org: ORG, p_user: actor, p_guest: guestHash, p_data: data, p_ref: reference })
      if (held.outcome === 'selection_conflict') return NextResponse.json({ error: 'A selected game, position, or price changed. Review your games again', code: 'CHECKOUT_SELECTION_CONFLICT', conflicts: held.conflicts, reference }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
      if (held.outcome === 'intent_mismatch') return NextResponse.json({ error: 'This request already created a different checkout. Continue its payment or review it first', code: 'CHECKOUT_INTENT_MISMATCH', checkout: held.checkout, reference }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
      if (held.outcome !== 'created' && held.outcome !== 'existing') throw new ClubError('Could not confirm the checkout. Retry the same request', 502, 'CHECKOUT_UNAVAILABLE')
      return result({ checkout: held.checkout, reference })
    }
    if (action === 'booking.player.update') {
      const data = validateBookingPlayerUpdate(body.data)
      const guestHash = actor ? null : await guest()
      if (!actor && !guestHash) throw new ClubError('Booking not found', 404, 'NOT_FOUND')
      let entry: unknown
      try { entry = await rpc('dvc_booking_player_update', { p_org: ORG, p_user: actor, p_guest: guestHash, p_data: data, p_ref: reference }) }
      catch (error) {
        if (error instanceof ClubError && error.code === 'CONFLICT' && error.message === 'Booking not found') throw new ClubError('Booking not found', 404, 'NOT_FOUND')
        throw error
      }
      return result({ entry, reference })
    }
    if (action === 'profile.skill.save') {
      return result({ profile: await saveManagementSkill(body.data, auth.role, actor, reference), reference })
    }
    const data = validateAction(action, body.data)
    requireAction(auth.role, action)
    if (action === 'access.save' && data.role === 'developer' && auth.role !== 'developer') throw new ClubError('Developer access required', 403, 'ACCESS_DENIED')
    if (action === 'access.save' && !('expected_version' in data)) {
      throw new ClubError('Refresh Users before changing access', 409, 'CONFLICT')
    }
    if (action === 'announcement.save') {
      const id = await rpc('dvc_save_scheduled_announcement', { p_org: ORG, p_user: actor, p_data: data, p_ref: reference })
      return result({ id, reference })
    }
    if (action === 'payment.save') {
      const input = record(body.data)
      const proof = verifyPaymentQrProof(input.qr_proof, actor, data.id, data.qr_path)
      const payment = data.id ? data : { ...data, request_id: uuid(input.request_id) }
      const id = await rpc('dvc_management_payment_save', { p_org: ORG, p_user: actor, p_data: payment, p_proven_path: proof, p_ref: reference })
      return result({ id, reference })
    }
    const id = action === 'access.save'
      ? await rpc('dvc_management_access_save', { p_org: ORG, p_user: actor, p_data: data, p_ref: reference })
      : action === 'game.save' && !('id' in data)
        ? await rpc('dvc_create_game_once', { p_org: ORG, p_user: actor, p_request: uuid(record(body.data).request_id), p_data: data, p_ref: reference })
        : action === 'game.save' && 'expected_start' in data
          ? await rpc('dvc_save_game_with_expected_start', { p_org: ORG, p_user: actor, p_data: data, p_expected_start: data.expected_start, p_ref: reference })
        : action === 'manual.register' && Array.isArray(data.games)
      ? await rpc('dvc_manual_register', { p_org: ORG, p_user: actor, p_data: data, p_ref: reference })
      : await rpc('dvc_admin', { p_org: ORG, p_user: actor, p_action: action, p_data: data, p_ref: reference })
    if ((action === 'game.cancel' || (action === 'game.save' && 'id' in data)) && gameNoticeDeliveryConfigured()) {
      after(async () => {
        try {
          const results = await deliverGameNotices()
          if (results?.deferred) console.error(JSON.stringify({ reference, code: 'GAME_NOTICE_PROVIDER_UNAVAILABLE' }))
          if (results?.unsettled) console.error(JSON.stringify({ reference, code: 'GAME_NOTICE_SETTLEMENT_PENDING' }))
        } catch {
          console.error(JSON.stringify({ reference, code: 'GAME_NOTICE_DELIVERY_PENDING' }))
        }
      })
    }
    return result({ id, reference })
  } catch (error) {
    const e = error instanceof ClubError ? error : new ClubError('Could not save. Try again', 500, 'UNEXPECTED_ERROR')
    await logFailure(reference, ['booking.player.update','guest.bootstrap','checkout.review','checkout.hold','booking.hold','manual.register','game.save','game.cancel','roster.update','booking.cancel','booking.transfer','receipt.approve','receipt.reject','payment.save','access.save','profile.skill.save','venue.save','venue.delete','faci.self','faci.assign','booking.details','announcement.save'].includes(action) ? action : 'unknown', e.code, actor)
    return NextResponse.json({ error: e.message, code: e.code, reference }, { status: e.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
