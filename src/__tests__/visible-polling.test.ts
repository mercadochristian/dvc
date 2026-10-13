import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startVisiblePolling } from '@/lib/visible-polling'

describe('visible polling', () => {
  let visibility: 'visible' | 'hidden'
  let source: Document
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    const events = new EventTarget()
    source = Object.defineProperty(events, 'visibilityState', { get: () => visibility }) as Document
  })
  afterEach(() => vi.useRealTimers())

  it('waits until the polling interval before refreshing', async () => {
    const poll = vi.fn(async () => {})
    const stop = startVisiblePolling(poll, source)
    expect(poll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(poll).toHaveBeenCalledTimes(1)
    stop()
  })

  it('pauses for hidden tabs and refreshes when the tab becomes visible', async () => {
    const poll = vi.fn(async () => {})
    const stop = startVisiblePolling(poll, source)
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(poll).not.toHaveBeenCalled()
    visibility = 'visible'
    source.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(poll).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not overlap refresh requests', async () => {
    let finish!: () => void
    const poll = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const stop = startVisiblePolling(poll, source)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(poll).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(poll).toHaveBeenCalledTimes(2)
    finish()
    stop()
  })

  it('stops polling and removes the visibility listener on cleanup', async () => {
    const poll = vi.fn(async () => {})
    const stop = startVisiblePolling(poll, source)
    stop()
    source.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(poll).not.toHaveBeenCalled()
  })
})
