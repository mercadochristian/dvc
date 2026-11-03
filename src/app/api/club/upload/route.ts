import { isAdministrator } from '@/lib/club/permissions'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db, guard, guest, identity, logFailure, ORG, rpc, storage } from '@/lib/club/server'
import { assertSameOrigin, ClubError, imageType, limitedBody, uuid } from '@/lib/club/validation'
import { requireAction } from '@/lib/club/permissions'
import type { Booking } from '@/lib/club/types'

export async function POST(request: Request) {
  const reference = randomUUID(); let actor: string | null = null, uploaded: string | null = null, receiptAttempted = false
  try {
    assertSameOrigin(request)
    await guard(request, 'upload', 30)
    if (Number(request.headers.get('content-length') || 0) > 3 * 1024 * 1024 + 20000) throw new ClubError('Use an image up to 3 MB', 413)
    const auth = await identity(); actor = auth.user?.id || null
    const body = await limitedBody(request, 3 * 1024 * 1024 + 20000)
    const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData(), kind = form.get('kind')
    let path: string, booking: string | null = null, method: string | null = null
    const guestHash = await guest()
    if (kind === 'qr') { requireAction(auth.role, 'payment.save'); path = `payments/${ORG}/${reference}` }
    else if (kind === 'receipt') {
      booking = uuid(form.get('booking')); method = uuid(form.get('method'))
      const owned = await rpc<boolean>('dvc_owned', { p_org: ORG, p_user: actor, p_guest: guestHash, p_booking: booking })
      if (!owned && !isAdministrator(auth.role)) throw new ClubError('Booking not found', 404, 'NOT_FOUND')
      const bookings = isAdministrator(auth.role) ? await db<Booking[]>(`bookings?id=eq.${booking}&organization_id=eq.${ORG}&select=*`) : await rpc<Booking[]>('dvc_bookings', { p_org: ORG, p_user: actor, p_guest: guestHash })
      const current = bookings.find(b => b.id === booking)
      if (current?.status === 'reserved') {
        const saved = await db<{ id: string }[]>(`receipts?booking_id=eq.${booking}&select=id`)
        if (saved.length) return NextResponse.json({ ok: true, reference })
      }
      if (!current || !(current.status === 'reserved' && isAdministrator(auth.role)) && (current.status !== 'holding' || Date.parse(current.expires_at) <= Date.now())) throw new ClubError('Your hold expired. Register again', 409, 'HOLD_EXPIRED')
      path = `receipts/${booking}/${reference}`
    } else throw new ClubError('Choose receipt or QR')
    const file = form.get('file')
    if (!(file instanceof File) || file.size > 3145728) throw new ClubError('Use an image up to 3 MB')
    const bytes = new Uint8Array(await file.arrayBuffer()), mime = imageType(bytes)
    path += mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : '.webp'
    await storage(`object/dvc-private/${path}`, { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes })
    uploaded = path
    if (booking) {
      receiptAttempted = true
      await rpc('dvc_receipt', { p_org: ORG, p_user: actor, p_guest: guestHash, p_booking: booking, p_method: method, p_path: path, p_ref: reference })
      uploaded = null // A later read failure must never delete a committed receipt.
      // Another concurrent request may have submitted first. Remove the unused upload.
      const saved = await db<{ path: string }[]>(`receipts?booking_id=eq.${booking}&select=path`)
      if (saved[0]?.path !== path) await storage(`object/dvc-private/${path}`, { method: 'DELETE' })
      return NextResponse.json({ ok: true, reference }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ path, reference }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // A transport failure can leave an RPC still running. Even a separate read
    // cannot prove it will not commit later. Retain attempted receipts for
    // delayed reconciliation rather than risk deleting a valid payment image.
    if (uploaded && !receiptAttempted) await storage(`object/dvc-private/${uploaded}`, { method: 'DELETE' }).catch(() => undefined)
    const e = error instanceof ClubError ? error : new ClubError('Upload failed. Try again', 500, 'UPLOAD_ERROR')
    await logFailure(reference, 'image.upload', e.code, actor)
    return NextResponse.json({ error: e.message, reference }, { status: e.status })
  }
}
