import { describe, expect, it, vi } from 'vitest'
import { handleDialogEscape } from '@/features/club/ui/shared/dialog-dismissal'

function key(overrides: Partial<Parameters<typeof handleDialogEscape>[0]> = {}) {
  return { key: 'Escape', defaultPrevented: false, repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides }
}
describe('controlled native dialog keyboard dismissal', () => {
  it('cancels the native default before asking the owner to close', () => {
    const order: string[] = []
    const event = key({ preventDefault: () => order.push('prevent native close'), stopPropagation: () => order.push('stop bubbling') })
    handleDialogEscape(event, true, () => order.push('controlled close'))
    expect(order).toEqual(['prevent native close', 'stop bubbling', 'controlled close'])
  })
  it('lets two distinct Escapes enter then leave a discard guard without relying on cancel-event cancelability', () => {
    let confirming = false
    const transition = vi.fn(() => { confirming = !confirming })
    const first = key(), second = key()
    handleDialogEscape(first, true, transition)
    expect(confirming).toBe(true)
    handleDialogEscape(second, true, transition)
    expect(confirming).toBe(false)
    expect(transition).toHaveBeenCalledTimes(2)
    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(second.preventDefault).toHaveBeenCalledOnce()
  })
  it('respects a nested control that already consumed Escape', () => {
    const event = key({ defaultPrevented: true }), close = vi.fn()
    handleDialogEscape(event, true, close)
    expect(close).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })
  it('keeps a mutation-protected dialog open and suppresses native closing', () => {
    const event = key(), close = vi.fn()
    handleDialogEscape(event, false, close)
    expect(close).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })
  it('does not cycle the owner state while Escape is held down', () => {
    const event = key({ repeat: true }), close = vi.fn()
    handleDialogEscape(event, true, close)
    expect(close).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
  it('leaves ordinary typing and navigation keys untouched', () => {
    const event = key({ key: 'Enter' }), close = vi.fn()
    handleDialogEscape(event, true, close)
    expect(close).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })
  it('leaves Escape to a native auto popover inside the current dialog', () => {
    const event = key(), close = vi.fn(), querySelector = vi.fn(() => ({ nativePopover: true }))
    handleDialogEscape(event, true, close, { querySelector })
    expect(querySelector).toHaveBeenCalledWith(':popover-open')
    expect(close).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })
  it('resumes controlled dismissal once that descendant popover is gone', () => {
    const querySelector = vi.fn().mockReturnValueOnce({ nativePopover: true }).mockReturnValue(null), close = vi.fn()
    handleDialogEscape(key(), true, close, { querySelector })
    expect(close).not.toHaveBeenCalled()
    const next = key()
    handleDialogEscape(next, true, close, { querySelector })
    expect(close).toHaveBeenCalledOnce()
    expect(next.preventDefault).toHaveBeenCalledOnce()
  })
  it('uses controlled Escape when the native popover selector is unsupported', () => {
    const event = key(), close = vi.fn(), querySelector = vi.fn(() => { throw new SyntaxError('Unsupported selector') })
    handleDialogEscape(event, true, close, { querySelector })
    expect(close).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

})
