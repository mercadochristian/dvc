import 'server-only'
import type { Checkout, CheckoutConflict } from '../model/types'
import { assetPath, ClubError } from '../model/validation'
import { ORG, rpc, storage } from './gateway'

export type CheckoutHoldResult = { outcome: 'created' | 'existing' | 'intent_mismatch'; checkout: Checkout } | { outcome: 'selection_conflict'; conflicts: CheckoutConflict[] }
type ReleasedUpload = { committed: true; checkout: Checkout } | { committed: false; path: string; delete_now: boolean } | null
const owner = (actor: string | null, guestHash: string | null, checkout: string) => ({ p_org: ORG, p_user: actor, p_guest: actor ? null : guestHash, p_checkout: checkout })

// Attempt tombstones stay durable even after a successful delete. A delayed
// Storage write can be found by a later owned read/retry or service operation.
// Cleanup failures never invalidate a committed reservation.
export async function reconcileCheckoutUploads(actor: string | null, guestHash: string | null, checkout: string) {
  try {
    const candidates = await rpc<{ id: string; path: string }[]>('dvc_checkout_cleanup_candidates', owner(actor, guestHash, checkout))
    for (const candidate of candidates) {
      assetPath(candidate.path, 'checkout-receipts', checkout)
      await storage(`object/dvc-private/${candidate.path}`, { method: 'DELETE' })
      await rpc('dvc_checkout_cleanup_checked', { ...owner(actor, guestHash, checkout), p_upload: candidate.id })
    }
  } catch { console.error(JSON.stringify({ code: 'CHECKOUT_CLEANUP_PENDING' })) }
}

export async function readCheckout(actor: string | null, guestHash: string | null, checkout: string): Promise<Checkout> {
  const value = await rpc<Checkout | null>('dvc_checkout_read', owner(actor, guestHash, checkout))
  if (!value) throw new ClubError('Checkout not found', 404, 'NOT_FOUND')
  await reconcileCheckoutUploads(actor, guestHash, checkout)
  return value
}

async function releaseUpload(actor: string | null, guestHash: string | null, checkout: string, upload: string, confirmed: boolean): Promise<Checkout | null> {
  const released = await rpc<ReleasedUpload>('dvc_checkout_upload_release', { ...owner(actor, guestHash, checkout), p_upload: upload, p_confirmed_upload: confirmed })
  if (released?.committed) return released.checkout
  if (released && released.delete_now) {
    assetPath(released.path, 'checkout-receipts', checkout)
    await storage(`object/dvc-private/${released.path}`, { method: 'DELETE' })
    await rpc('dvc_checkout_cleanup_checked', { ...owner(actor, guestHash, checkout), p_upload: upload })
  }
  return null
}

export async function submitCheckoutReceipt(actor: string | null, guestHash: string | null, checkout: string, method: string, bytes: Uint8Array<ArrayBuffer>, mime: string, reference: string): Promise<Checkout> {
  const current = await readCheckout(actor, guestHash, checkout)
  if (current.status === 'reserved' && current.receipt) return current
  if (current.status !== 'holding' || Date.parse(current.expires_at) <= Date.now()) throw new ClubError('Your hold expired. Review your games again', 409, 'HOLD_EXPIRED')
  const path = `checkout-receipts/${checkout}/${reference}.${mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'}`
  let prepared = false, confirmed = false
  try {
    // Persist the attempt before touching Storage. If a preparation response is
    // lost it still has a durable path, but no Storage request has been issued.
    await rpc('dvc_checkout_upload_prepare', { ...owner(actor, guestHash, checkout), p_method: method, p_upload: reference, p_path: path })
    prepared = true
    await storage(`object/dvc-private/${path}`, { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes })
    confirmed = true
    const saved = await rpc<Checkout>('dvc_checkout_receipt', { ...owner(actor, guestHash, checkout), p_upload: reference, p_ref: reference })
    // A concurrent attempt can win; only a serialized discard permits deletion.
    await releaseUpload(actor, guestHash, checkout, reference, true).catch(() => { console.error(JSON.stringify({ code: 'CHECKOUT_CLEANUP_PENDING' })) })
    return saved
  } catch (error) {
    if (prepared) {
      try {
        // This locks behind an uncertain finalization. A committed attempt is
        // recovered as success; otherwise discard fences any delayed RPC.
        const recovered = await releaseUpload(actor, guestHash, checkout, reference, confirmed)
        if (recovered) return recovered
      } catch { console.error(JSON.stringify({ code: 'CHECKOUT_RECONCILIATION_PENDING' })) }
    }
    throw error
  }
}
