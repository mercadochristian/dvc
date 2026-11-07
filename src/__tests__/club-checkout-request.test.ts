import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckoutReviewRequest, checkoutFromResponse, checkoutHoldFailure, checkoutMutation, resolvePendingCheckout } from '@/features/club/ui/registration/checkout-request'
import { RequestError } from '@/features/club/api/client'
import type { Booking, Checkout, CheckoutDraft, CheckoutQuote } from '@/features/club/model/types'

const gameId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222', checkoutId = '33333333-3333-4333-8333-333333333333'
const player = { name: 'Ana', position: 'open' as const, is_registrant: true, has_details: true, level: 'intermediate' as const, gender: 'female' as const, birth_date: '1995-01-02', first_timer: false }
function draft(): CheckoutDraft { return { request_id: requestId, organizer: { name: 'Ana', contact: '+639000000000', email: 'ana@example.test' }, games: [{ game_id: gameId, kind: 'individual', organizer_plays: true, players: [{ ...player }] }] } }
function quote(input = draft()): CheckoutQuote {
  return { amount: 30000, games: input.games.map(game => ({ ...game, amount: 30000, venue: 'QA Court', city: 'Makati', maps_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', quote: { venue: 'QA Court', city: 'Makati', maps_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', team_price: 165000, position_prices: { open: 30000 } } })) }
}
const booking: Booking = { id: '44444444-4444-4444-8444-444444444444', checkout_id: checkoutId, game_id: gameId, kind: 'individual', captain_name: 'Ana', amount: 30000, status: 'holding', payment_status: 'pending', expires_at: '2030-01-01T10:10:00Z', created_at: '2030-01-01T10:00:00Z' }
const checkout: Checkout = { request_id: requestId, id: checkoutId, status: 'holding', payment_status: 'pending', amount: 30000, expires_at: booking.expires_at, created_at: booking.created_at, bookings: [booking] }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail }); return { promise, resolve, reject } }
afterEach(() => vi.useRealTimers())

describe('registration review request ownership', () => {
  it('accepts a paired immutable current review', async () => {
    const request = new CheckoutReviewRequest(), accept = vi.fn()
    await request.load(draft(), async input => ({ checkout: quote(input) }), accept, vi.fn())
    expect(accept.mock.calls[0][0].draft.request_id).toBe(requestId)
  })
  it('waits for guest bootstrap before requesting the quote', async () => {
    const request = new CheckoutReviewRequest(), bootstrap = deferred<void>(), transport = vi.fn(async input => ({ checkout: quote(input) })), accept = vi.fn()
    const pending = request.load(draft(), transport, accept, vi.fn(), () => bootstrap.promise)
    expect(transport).not.toHaveBeenCalled()
    bootstrap.resolve(); await pending
    expect(transport).toHaveBeenCalledOnce(); expect(accept).toHaveBeenCalledOnce()
  })
  it('lets bootstrap settle after dismissal but never requests the stale quote', async () => {
    const request = new CheckoutReviewRequest(), bootstrap = deferred<void>(), transport = vi.fn(), accept = vi.fn()
    const pending = request.load(draft(), transport, accept, vi.fn(), () => bootstrap.promise)
    request.invalidate(); bootstrap.resolve(); await pending
    expect(transport).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled()
  })
  it('does not request a quote when bootstrap rejects, and ignores stale bootstrap failures', async () => {
    const request = new CheckoutReviewRequest(), transport = vi.fn(), reject = vi.fn(), failure = new Error('Browser unavailable')
    await request.load(draft(), transport, vi.fn(), reject, async () => { throw failure })
    expect(reject).toHaveBeenCalledWith(failure); expect(transport).not.toHaveBeenCalled()
    reject.mockClear(); const bootstrap = deferred<void>()
    const pending = request.load(draft(), transport, vi.fn(), reject, () => bootstrap.promise)
    request.invalidate(); bootstrap.reject(failure); await pending
    expect(reject).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled()
  })
  it('captures the input before awaiting the real transport boundary', async () => {
    const request = new CheckoutReviewRequest(), response = deferred<{ checkout: CheckoutQuote }>(), accept = vi.fn(), input = draft()
    const pending = request.load(input, () => response.promise, accept, vi.fn())
    input.organizer.contact = 'Changed'; input.games[0].players[0].birth_date = '2000-01-01'
    response.resolve({ checkout: quote() }); await pending
    expect(accept.mock.calls[0][0].draft.organizer.contact).toBe('+639000000000')
    expect(accept.mock.calls[0][0].draft.games[0].players[0].birth_date).toBe('1995-01-02')
  })
  it('ignores a late quote after a draft edit or dialog dismissal invalidates it', async () => {
    const request = new CheckoutReviewRequest(), response = deferred<{ checkout: CheckoutQuote }>(), accept = vi.fn()
    const pending = request.load(draft(), () => response.promise, accept, vi.fn())
    request.invalidate(); response.resolve({ checkout: quote() }); await pending
    expect(accept).not.toHaveBeenCalled()
  })
  it('does not overwrite a newer review when the older response arrives last', async () => {
    const request = new CheckoutReviewRequest(), old = deferred<{ checkout: CheckoutQuote }>(), accept = vi.fn()
    const pending = request.load(draft(), () => old.promise, accept, vi.fn())
    const newer = draft(); newer.request_id = '55555555-5555-4555-8555-555555555555'
    await request.load(newer, async input => ({ checkout: quote(input) }), accept, vi.fn())
    old.resolve({ checkout: quote() }); await pending
    expect(accept.mock.calls.map(([reviewed]) => reviewed.draft.request_id)).toEqual([newer.request_id])
  })
  it('ignores a stale error after an identity change invalidates the request', async () => {
    const request = new CheckoutReviewRequest(), response = deferred<{ checkout: CheckoutQuote }>(), reject = vi.fn()
    const pending = request.load(draft(), () => response.promise, vi.fn(), reject)
    request.invalidate(); response.reject(new Error('Late old-account error')); await pending
    expect(reject).not.toHaveBeenCalled()
  })
  it('rejects a mismatched same-game participant response before showing it', async () => {
    const request = new CheckoutReviewRequest(), reject = vi.fn(), invalid = quote()
    invalid.games[0].players[0].birth_date = '2001-02-03'
    await request.load(draft(), async () => ({ checkout: invalid }), vi.fn(), reject)
    expect(reject.mock.calls[0][0].message).toContain('Review')
  })
  it('reports invalid input without sending it to the network', async () => {
    const request = new CheckoutReviewRequest(), transport = vi.fn(), reject = vi.fn()
    await request.load({ ...draft(), games: [] }, transport, vi.fn(), reject)
    expect(transport).not.toHaveBeenCalled(); expect(reject).toHaveBeenCalled()
  })
})

describe('bounded checkout mutations', () => {
  it('releases its timeout after a successful response', async () => {
    vi.useFakeTimers()
    await expect(checkoutMutation(async () => checkout, 100)).resolves.toBe(checkout)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts a stalled transport and returns an unconfirmed outcome within the bound', async () => {
    vi.useFakeTimers(); let signal!: AbortSignal
    const response = deferred<Checkout>()
    const pending = checkoutMutation(value => { signal = value; return response.promise }, 100)
    const rejected = expect(pending).rejects.toThrow('status could not be confirmed')
    await vi.advanceTimersByTimeAsync(100); await rejected
    expect(signal.aborted).toBe(true)
    response.resolve(checkout)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves the original transport failure without extending the timeout', async () => {
    vi.useFakeTimers(); const failure = new Error('Disconnected')
    await expect(checkoutMutation(async () => { throw failure }, 100)).rejects.toBe(failure)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('truthful hold resolution', () => {
  it('allows editing only for the explicit server-proven no-hold outcome', () => expect(checkoutHoldFailure(new RequestError('Changed', 'ref', 409, 'CHECKOUT_SELECTION_CONFLICT', undefined, [{ game_id: gameId, code: 'PRICE_CHANGED' }]))).toEqual({ kind: 'selection-conflict', issues: { [gameId]: 'The price changed. Review the latest total before continuing.' } }))
  it('resolves a definitive saved-skill decline and requests a profile refresh', () => {
    expect(checkoutHoldFailure(new RequestError('Changed', 'ref', 409, 'CHECKOUT_SELECTION_CONFLICT', undefined,
      [{ game_id: gameId, code: 'SKILL_CHANGED' }]))).toMatchObject({
      kind: 'selection-conflict', skillChanged: true,
      issues: { [gameId]: expect.stringContaining('saved skill level changed') },
    })
  })
  it.each([400, 409, 500, 502])('does not treat generic HTTP %s as proof that no hold exists', status => expect(checkoutHoldFailure(new RequestError('Request failed', 'ref', status, 'CONFLICT'))).toEqual({ kind: 'unconfirmed' }))
  it('retains an unknown network result for the same request retry', () => expect(checkoutHoldFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'unconfirmed' }))
  it('resolves an intent mismatch to the actual owned original checkout', () => expect(checkoutHoldFailure(new RequestError('Existing intent', 'ref', 409, 'CHECKOUT_INTENT_MISMATCH', checkout))).toEqual({ kind: 'existing', checkout }))
  it('does not resolve an intent mismatch with a malformed original DTO', () => expect(checkoutHoldFailure(new RequestError('Existing intent', 'ref', 409, 'CHECKOUT_INTENT_MISMATCH', { id: checkoutId } as Checkout))).toEqual({ kind: 'unconfirmed' }))
  it('rejects an empty or unparseable successful hold response as unconfirmed', () => expect(() => checkoutFromResponse(undefined)).toThrow('status could not be confirmed'))
  it('rejects child bookings belonging to a different checkout', () => expect(() => checkoutFromResponse({ ...checkout, bookings: [{ ...booking, checkout_id: 'different' }] })).toThrow('status could not be confirmed'))
})

describe('resuming an unknown hold through My bookings', () => {
  it('clears the matching pending intent as soon as its authorized checkout is recovered', () => {
    const pending = { payload: draft() }
    expect(resolvePendingCheckout(pending, checkoutFromResponse(checkout))).toBeNull()
    expect(resolvePendingCheckout(pending, { ...checkout, status: 'reserved', payment_status: 'approved' })).toBeNull()
  })
  it('preserves an unrelated pending intent when another owned checkout loads or completes', () => {
    const pending = { payload: draft() }, unrelated = { ...checkout, request_id: '55555555-5555-4555-8555-555555555555' }
    expect(resolvePendingCheckout(pending, unrelated)).toBe(pending)
    expect(resolvePendingCheckout(pending, { ...unrelated, status: 'reserved', payment_status: 'approved' })).toBe(pending)
  })
  it('does not accept an authorized DTO without its request identity as a resolved hold', () => {
    const { request_id: _omitted, ...missing } = checkout
    expect(() => checkoutFromResponse(missing)).toThrow('status could not be confirmed')
  })
})
