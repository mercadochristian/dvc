import type { Checkout, CheckoutDraft, CheckoutQuote } from '@/features/club/model/types'
import { validateCheckoutDraft } from '@/features/club/model/validation'
import { quotedCheckoutDraft } from '@/features/club/model/checkout-form'
import { RequestError } from '@/features/club/api/client'

export interface ReviewedCheckout { draft: CheckoutDraft; quote: CheckoutQuote }

/** Only the current editable registration intent may receive a review result. */
export class CheckoutReviewRequest {
  private generation = 0
  invalidate() { this.generation += 1 }
  async load(input: CheckoutDraft, request: (draft: CheckoutDraft) => Promise<{ checkout: CheckoutQuote }>, accept: (reviewed: ReviewedCheckout) => void, reject: (error: unknown) => void, prepare?: () => Promise<void>) {
    const generation = ++this.generation
    try {
      const draft = validateCheckoutDraft(input)
      if (prepare) await prepare()
      if (generation !== this.generation) return
      const result = await request(draft)
      const reviewed = { draft, quote: result.checkout }
      // Reject mismatched responses before showing their participant summary.
      quotedCheckoutDraft(draft, reviewed)
      if (generation === this.generation) accept(reviewed)
    } catch (error) { if (generation === this.generation) reject(error) }
  }
}

/** An aborted transport does not prove the server rolled back the checkout. */
export async function checkoutMutation<T>(request: (signal: AbortSignal) => Promise<T>, timeout = 20_000): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('The reservation status could not be confirmed. Check its status before starting another checkout.')) }, timeout)
  })
  try { return await Promise.race([request(controller.signal), expired]) } finally { clearTimeout(timer!) }
}

export function checkoutFromResponse(value: unknown): Checkout {
  const checkout = value as Partial<Checkout> | null | undefined
  if (!checkout || typeof checkout.id !== 'string' || typeof checkout.request_id !== 'string' || !checkout.request_id || !['holding', 'reserved', 'expired', 'cancelled'].includes(checkout.status || '') || !['pending', 'approved'].includes(checkout.payment_status || '') || typeof checkout.amount !== 'number' || !Number.isSafeInteger(checkout.amount) || checkout.amount < 0 || typeof checkout.expires_at !== 'string' || !Number.isFinite(Date.parse(checkout.expires_at)) || !Array.isArray(checkout.bookings) || !checkout.bookings.length || checkout.bookings.some(booking => !booking || typeof booking.id !== 'string' || typeof booking.game_id !== 'string' || !['individual', 'group', 'team'].includes(booking.kind) || !Number.isSafeInteger(booking.amount) || booking.amount < 0 || !['holding', 'reserved', 'cancelled', 'rejected', 'expired'].includes(booking.status) || !['pending', 'approved', 'rejected'].includes(booking.payment_status) || booking.checkout_id !== checkout.id)) throw new Error('The reservation status could not be confirmed. Check its status before starting another checkout.')
  return checkout as Checkout
}

export function checkoutHoldFailure(error: unknown): { kind: 'selection-conflict'; issues: Record<string, string>; skillChanged?: boolean } | { kind: 'existing'; checkout: Checkout } | { kind: 'unconfirmed' } {
  if (error instanceof RequestError && error.code === 'CHECKOUT_INTENT_MISMATCH' && error.checkout) {
    try { return { kind: 'existing', checkout: checkoutFromResponse(error.checkout) } } catch { return { kind: 'unconfirmed' } }
  }
  // This code is returned only after the server proves the request key absent
  // and before any booking/hold writes. No generic 4xx/409 has that meaning.
  if (error instanceof RequestError && error.status === 409 && error.code === 'CHECKOUT_SELECTION_CONFLICT') return {
    kind: 'selection-conflict',
    ...((error.conflicts || []).some(conflict => conflict.code === 'SKILL_CHANGED') ? { skillChanged: true } : {}),
    issues: Object.fromEntries((error.conflicts || []).map(conflict => [conflict.game_id, conflict.code === 'SKILL_CHANGED' ? 'Your saved skill level changed. Review the updated level before continuing.' : conflict.code === 'PRICE_CHANGED' ? 'The price changed. Review the latest total before continuing.' : conflict.code === 'SCHEDULE_CHANGED' ? 'The schedule changed. Review the latest game details before continuing.' : 'These player positions are no longer available. Change the selection or remove this game.'])),
  }
  return { kind: 'unconfirmed' }
}

/** Only an authorized checkout for this exact intent resolves an unknown hold. */
export function resolvePendingCheckout<T extends { payload: { request_id: string } }>(pending: T | null, checkout: Checkout): T | null {
  return pending && checkout.request_id === pending.payload.request_id ? null : pending
}
