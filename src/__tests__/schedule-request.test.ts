import { describe, expect, it } from 'vitest'
import { createScheduleRequestManager } from '@/lib/schedule-request'

describe('createScheduleRequestManager', () => {
  it('aborts the previous request when a new request starts', () => {
    const manager = createScheduleRequestManager()
    const first = manager.start()
    manager.start()
    expect(first.signal.aborted).toBe(true)
  })

  it('marks the previous request as stale when a new request starts', () => {
    const manager = createScheduleRequestManager()
    const first = manager.start()
    manager.start()
    expect(first.isCurrent()).toBe(false)
  })

  it('marks the current request as current', () => {
    const manager = createScheduleRequestManager()
    const current = manager.start()
    expect(current.isCurrent()).toBe(true)
  })

  it('aborts the active request on cleanup', () => {
    const manager = createScheduleRequestManager()
    const current = manager.start()
    manager.abort()
    expect(current.signal.aborted).toBe(true)
  })
})
