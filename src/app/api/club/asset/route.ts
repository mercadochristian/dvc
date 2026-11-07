import { isAdministrator } from '@/features/club/model/permissions'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db, guest, identity, logFailure, ORG, rpc, storage } from '@/features/club/server/gateway'
import { assetPath, ClubError, uuid } from '@/features/club/model/validation'

export async function GET(request: Request) {
  const reference = randomUUID(); let actor: string | null = null
  try {
    const query = new URL(request.url).searchParams, id = uuid(query.get('id'))
    let path: string | null = null
    if (query.get('kind') === 'qr') {
      const rows = await db<{ qr_path: string | null }[]>(`payment_methods?id=eq.${id}&organization_id=eq.${ORG}&enabled=eq.true&select=qr_path`)
      path = rows[0]?.qr_path || null
    } else if (query.get('kind') === 'checkout_receipt') {
      const auth = await identity(); actor = auth.user?.id || null
      const owned = await rpc<boolean>('dvc_checkout_owned', { p_org: ORG, p_user: actor, p_guest: actor ? null : await guest(), p_checkout: id })
      if (!isAdministrator(auth.role) && !owned) throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
      const checkout = await db<{ id: string }[]>(`checkouts?id=eq.${id}&organization_id=eq.${ORG}&select=id`)
      if (checkout.length) path = (await db<{ path: string }[]>(`checkout_receipts?checkout_id=eq.${id}&select=path`))[0]?.path || null
    } else if (query.get('kind') === 'receipt') {
      const auth = await identity(); actor = auth.user?.id || null
      const owned = await rpc<boolean>('dvc_owned', { p_org: ORG, p_user: actor, p_guest: await guest(), p_booking: id })
      if (!isAdministrator(auth.role) && !owned) throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
      const rows = await db<{ path: string }[]>(`receipts?booking_id=eq.${id}&select=path`)
      // Admins also remain scoped to this organization.
      const booking = await db<{ id: string }[]>(`bookings?id=eq.${id}&organization_id=eq.${ORG}&select=id`)
      if (booking.length) path = rows[0]?.path || null
    }
    if (!path) throw new ClubError('Image not found', 404, 'NOT_FOUND')
    assetPath(path, query.get('kind') === 'qr' ? 'payments' : query.get('kind') === 'checkout_receipt' ? 'checkout-receipts' : 'receipts', query.get('kind') === 'qr' ? ORG : id)
    const response = await storage(`object/authenticated/dvc-private/${path}`)
    return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } })
  } catch (error) {
    const e = error instanceof ClubError ? error : new ClubError('Could not open image', 500, 'ASSET_ERROR')
    await logFailure(reference, 'image.read', e.code, actor)
    return NextResponse.json({ error: e.message, reference }, { status: e.status })
  }
}
