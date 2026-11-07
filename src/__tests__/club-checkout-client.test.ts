import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, ensureGuestSession, RequestError, upload } from '@/features/club/api/client'

afterEach(() => vi.unstubAllGlobals())
function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('checkout browser transport boundary', () => {
  it('preserves the frozen request ID and consent payload when sending a hold', async () => {
    const fetch = respond({ checkout: { id: 'owned-checkout' } }), payload = { request_id: 'same-original-key', games: [{ expected_amount: 0 }] }
    await act('checkout.hold', payload)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'checkout.hold', data: payload })
  })
  it('passes a cancellation signal to a bounded hold transport', async () => {
    const fetch = respond({}), controller = new AbortController()
    await act('checkout.hold', {}, controller.signal)
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })
  it('keeps existing action callers unchanged when there is no signal', async () => {
    const fetch = respond({ id: 'legacy-id' })
    await expect(act('legacy.action', {})).resolves.toEqual({ id: 'legacy-id' })
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('signal')
  })
  it('returns the actual checkout receipt response instead of inventing a path result', async () => {
    respond({ checkout: { id: 'owned-checkout', status: 'reserved', payment_status: 'approved' } })
    await expect(upload<{ checkout: { id: string } }>(new FormData())).resolves.toMatchObject({ checkout: { id: 'owned-checkout' } })
  })
  it('passes the original receipt FormData and abort signal without adding a JSON header', async () => {
    const fetch = respond({}), data = new FormData(), controller = new AbortController()
    await upload(data, controller.signal)
    expect(fetch.mock.calls[0][1]).toEqual({ method: 'POST', body: data, signal: controller.signal })
  })
  it('retains only recognized conflict entries for targeted correction', async () => {
    respond({ error: 'Changed', reference: 'safe-ref', code: 'CHECKOUT_SELECTION_CONFLICT', conflicts: [{ game_id: 'a', code: 'PRICE_CHANGED', extra: 'not retained' }, { game_id: 'b', code: 'UNKNOWN' }, { secret: 'not retained' }] }, 409)
    try { await act('checkout.hold', {}) } catch (error) {
      expect(error).toBeInstanceOf(RequestError)
      expect(error).toMatchObject({ status: 409, code: 'CHECKOUT_SELECTION_CONFLICT', reference: 'safe-ref', conflicts: [{ game_id: 'a', code: 'PRICE_CHANGED' }] })
      return
    }
    throw new Error('Expected a rejected response')
  })
  it('does not attach an arbitrary checkout object to unrelated error codes', async () => {
    respond({ error: 'Denied', code: 'ACCESS_DENIED', checkout: { id: 'not owned' } }, 403)
    await expect(act('checkout.hold', {})).rejects.toMatchObject({ code: 'ACCESS_DENIED', checkout: undefined })
  })
  it('does not resolve a malformed original checkout DTO from an intent mismatch', async () => {
    respond({ error: 'Mismatch', code: 'CHECKOUT_INTENT_MISMATCH', checkout: { id: 'incomplete' } }, 409)
    await expect(act('checkout.hold', {})).rejects.toMatchObject({ code: 'CHECKOUT_INTENT_MISMATCH', checkout: undefined })
  })
})

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function nativeLockHarness() {
  let tail = Promise.resolve()
  const request = vi.fn((_name: string, callback: () => Promise<void>) => {
    const result = tail.then(callback)
    tail = result.catch(() => {})
    return result
  })
  vi.stubGlobal('navigator', { locks: { request } })
  return request
}
describe('serialized guest cookie bootstrap', () => {
  it('holds the cross-tab lock through response parsing and never passes an abort signal', async () => {
    const request = nativeLockHarness(), firstBody = deferred<{ ready: boolean }>()
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: () => firstBody.promise }).mockResolvedValueOnce(new Response(JSON.stringify({ ready: true })))
    vi.stubGlobal('fetch', fetch)
    const first = ensureGuestSession(), second = ensureGuestSession()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(request.mock.calls.map(([name]) => name)).toEqual(['dvc-guest-owner-v1', 'dvc-guest-owner-v1'])
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('signal')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'guest.bootstrap', data: {} })
    firstBody.resolve({ ready: true }); await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('keeps a pending network response serialized without installing a timeout', async () => {
    nativeLockHarness(); const response = deferred<Response>(), timeout = vi.spyOn(globalThis, 'setTimeout')
    const fetch = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValueOnce(new Response(JSON.stringify({ ready: true })))
    vi.stubGlobal('fetch', fetch)
    const first = ensureGuestSession(), second = ensureGuestSession()
    await Promise.resolve(); await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1); expect(timeout).not.toHaveBeenCalled()
    timeout.mockRestore()
    response.resolve(new Response(JSON.stringify({ ready: true }))); await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('releases after an actual rejection so a later attempt can establish its session', async () => {
    nativeLockHarness(); const failure = new TypeError('Disconnected')
    const fetch = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response(JSON.stringify({ ready: true })))
    vi.stubGlobal('fetch', fetch)
    const first = ensureGuestSession(), second = ensureGuestSession()
    await expect(first).rejects.toBe(failure); await expect(second).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('fails closed without native locks and does not send a bootstrap request', async () => {
    vi.stubGlobal('navigator', {}); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(ensureGuestSession()).rejects.toThrow('current browser')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a malformed successful bootstrap instead of continuing registration', async () => {
    nativeLockHarness(); respond({})
    await expect(ensureGuestSession()).rejects.toThrow('could not be prepared')
  })
})
