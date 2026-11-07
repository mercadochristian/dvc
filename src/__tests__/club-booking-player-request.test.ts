import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestError } from '@/features/club/api/client'
import { confirmedPlayerUpdate, PlayerUpdateUnknown } from '@/features/club/ui/registration/booking-player-request'

const target = { booking_id: 'booking', entry_id: 'entry', expected_version: 3 }
afterEach(() => vi.useRealTimers())
describe('bounded personal-detail updates', () => {
  it('accepts only the targeted entry and incremented version', async () => {
    const entry = { id: 'entry', booking_id: 'booking', version: 4 }
    await expect(confirmedPlayerUpdate(async () => ({ entry }), target)).resolves.toEqual(entry)
  })
  it('bounds a stalled response and aborts delivery without claiming no update', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const pending = confirmedPlayerUpdate(value => { signal = value; return new Promise(() => {}) }, target)
    const assertion = expect(pending).rejects.toBeInstanceOf(PlayerUpdateUnknown)
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
    expect(signal?.aborted).toBe(true)
  })
  it('does not turn a late committed response into an accepted UI result after timeout', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    const pending = confirmedPlayerUpdate(() => new Promise(accept => { resolve = accept }), target)
    const assertion = expect(pending).rejects.toBeInstanceOf(PlayerUpdateUnknown)
    await vi.advanceTimersByTimeAsync(20_000); await assertion
    resolve({ entry: { id: 'entry', booking_id: 'booking', version: 4 } })
    await Promise.resolve()
    await expect(pending).rejects.toBeInstanceOf(PlayerUpdateUnknown)
  })
  it('preserves a definitive stale-version rejection', async () => {
    const failure = new RequestError('Refresh before editing', undefined, 400)
    await expect(confirmedPlayerUpdate(async () => { throw failure }, target)).rejects.toBe(failure)
  })
  it.each([
    { id: 'wrong', booking_id: 'booking', version: 4 },
    { id: 'entry', booking_id: 'wrong', version: 4 },
    { id: 'entry', booking_id: 'booking', version: 3 },
    undefined,
  ])('treats an unconfirmed response shape as unknown', async entry => {
    await expect(confirmedPlayerUpdate(async () => ({ entry }), target)).rejects.toBeInstanceOf(PlayerUpdateUnknown)
  })
  it('treats transport and server failures as unknown', async () => {
    await expect(confirmedPlayerUpdate(async () => { throw new Error('Connection lost') }, target)).rejects.toBeInstanceOf(PlayerUpdateUnknown)
    await expect(confirmedPlayerUpdate(async () => { throw new RequestError('Server error', undefined, 500) }, target)).rejects.toBeInstanceOf(PlayerUpdateUnknown)
  })
})
