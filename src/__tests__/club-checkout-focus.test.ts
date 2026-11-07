import { describe, expect, it, vi } from 'vitest'
import { focusCheckoutStage, restoreCheckoutFocus } from '@/features/club/ui/registration/checkout-focus'

function element(extra = {}) { return { focus: vi.fn(), isConnected: true, ...extra } as unknown as HTMLElement }
describe('checkout stage entry', () => {
  it('resets the actual scrolling dialog body before focusing the new stage without scrolling', () => {
    const body = { scrollTop: 649 }, focus = vi.fn(() => expect(body.scrollTop).toBe(0))
    const stage = element({ closest: vi.fn(() => body), focus })
    focusCheckoutStage(stage)
    expect(stage.closest).toHaveBeenCalledWith('.club-dialog-body')
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })
  it('does nothing for an unmounted stage', () => expect(() => focusCheckoutStage(null)).not.toThrow())
})
describe('resumed checkout focus after booking refresh', () => {
  it('returns to the newly rendered button for the invoking checkout, not another checkout', () => {
    const other = element({ dataset: { checkoutResume: 'other' } }), replacement = element({ dataset: { checkoutResume: 'original' } })
    const list = element({ querySelectorAll: () => [other, replacement] }), heading = element(), body = element()
    restoreCheckoutFocus(list, heading, 'original', element({ isConnected: false }), body, body)
    expect(replacement.focus).toHaveBeenCalledWith({ preventScroll: true }); expect(other.focus).not.toHaveBeenCalled(); expect(heading.focus).not.toHaveBeenCalled()
  })
  it('uses the stable page heading if expiry or refresh removed the checkout button', () => {
    const heading = element(), body = element(), list = element({ querySelectorAll: () => [] })
    restoreCheckoutFocus(list, heading, 'expired', null, body, body)
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
  it('does not steal focus when the user selects another control during loading', () => {
    const heading = element(), body = element(), userControl = element()
    restoreCheckoutFocus(null, heading, 'original', null, userControl, body)
    expect(heading.focus).not.toHaveBeenCalled()
  })
  it('returns to the replacement personal-edit button for the selected booking', () => {
    const other = element({ dataset: { bookingPlayerEdit: 'other' } }), replacement = element({ dataset: { bookingPlayerEdit: 'original' } })
    const list = element({ querySelectorAll: vi.fn(() => [other, replacement]) }), heading = element(), body = element()
    restoreCheckoutFocus(list, heading, 'original', null, body, body, 'player')
    expect(list.querySelectorAll).toHaveBeenCalledWith('[data-booking-player-edit]')
    expect(replacement.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(other.focus).not.toHaveBeenCalled()
  })
  it('uses the stable heading when the edit window closes while the modal is open', () => {
    const disabled = element({ disabled: true, dataset: { bookingPlayerEdit: 'original' } })
    const list = element({ querySelectorAll: () => [disabled] }), heading = element(), body = element()
    restoreCheckoutFocus(list, heading, 'original', null, body, body, 'player')
    expect(disabled.focus).not.toHaveBeenCalled()
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
