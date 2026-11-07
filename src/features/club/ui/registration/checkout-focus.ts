/** Enter a new checkout stage at its beginning without animated scroll/focus. */
export function focusCheckoutStage(element: HTMLElement | null) {
  if (!element) return
  const body = element.closest<HTMLElement>('.club-dialog-body')
  if (body) body.scrollTop = 0
  element.focus({ preventScroll: true })
}

/** Refresh may replace the invoking button. Never pull focus from a user action. */
export function restoreCheckoutFocus(list: HTMLElement | null, heading: HTMLElement | null, id: string, previous: HTMLElement | null, active: Element | null, body: HTMLElement, target: 'checkout' | 'player' = 'checkout') {
  if (active && active !== body && active !== heading && active !== previous && active.isConnected) return
  const selector = target === 'player' ? '[data-booking-player-edit]' : '[data-checkout-resume]'
  const button = Array.from(list?.querySelectorAll<HTMLButtonElement>(selector) || []).find(entry => !entry.disabled && (target === 'player' ? entry.dataset.bookingPlayerEdit : entry.dataset.checkoutResume) === id)
  ;(button || heading)?.focus({ preventScroll: true })
}
