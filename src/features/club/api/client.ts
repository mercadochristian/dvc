import type { Checkout, CheckoutConflict } from '@/features/club/model/types'
export class RequestError extends Error {
  constructor(message: string, public reference?: string, public status?: number, public code?: string, public checkout?: Checkout, public conflicts?: CheckoutConflict[]) { super(message) }
}
export async function read<T>(view: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`/api/club?${new URLSearchParams({ view, ...params })}`, { cache: 'no-store' })
  return unpack<T>(response)
}
export async function act<T = { id: string }>(action: string, data: unknown, signal?: AbortSignal): Promise<T> {
  return unpack<T>(await fetch('/api/club', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }), ...(signal ? { signal } : {}) }))
}
/** Keep cookie creation serialized across tabs until the actual response settles.
 * Deliberately no timeout/abort: releasing early could let a late Set-Cookie
 * replace the guest owner used by a subsequent reservation.
 */
export async function ensureGuestSession(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('Guest registration needs a current browser. Update your browser or sign in to continue.')
  await navigator.locks.request('dvc-guest-owner-v1', async () => {
    const result = await act<{ ready: boolean }>('guest.bootstrap', {})
    if (result.ready !== true) throw new Error('Guest registration could not be prepared. Try again or sign in to continue.')
  })
}
export async function upload<T = { path?: string }>(data: FormData, signal?: AbortSignal): Promise<T> {
  return unpack<T>(await fetch('/api/club/upload', { method: 'POST', body: data, ...(signal ? { signal } : {}) }))
}
async function unpack<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => ({}))
  if (!response.ok) {
    const conflicts = Array.isArray(value.conflicts) ? value.conflicts.filter((entry: unknown): entry is CheckoutConflict => {
      if (!entry || typeof entry !== 'object') return false
      const conflict = entry as Record<string, unknown>
      return typeof conflict.game_id === 'string' && ['SELECTION_UNAVAILABLE', 'PRICE_CHANGED', 'SCHEDULE_CHANGED', 'SKILL_CHANGED'].includes(String(conflict.code))
    }).map(({ game_id, code }: CheckoutConflict) => ({ game_id, code })) : undefined
    const prior = value.checkout
    const checkout = value.code === 'CHECKOUT_INTENT_MISMATCH' && prior && typeof prior === 'object' && typeof prior.id === 'string' && typeof prior.request_id === 'string' && prior.request_id.length > 0 && ['holding', 'reserved', 'expired', 'cancelled'].includes(prior.status) && ['pending', 'approved'].includes(prior.payment_status) && Number.isSafeInteger(prior.amount) && prior.amount >= 0 && typeof prior.expires_at === 'string' && Array.isArray(prior.bookings) ? prior as Checkout : undefined
    throw new RequestError(value.error || 'Something went wrong. Try again', value.reference, response.status, typeof value.code === 'string' ? value.code : undefined, checkout, conflicts)
  }
  return value as T
}
