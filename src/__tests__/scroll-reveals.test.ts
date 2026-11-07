import { afterEach, describe, expect, it, vi } from 'vitest'
import { startScrollReveals } from '@/features/motion/scroll-reveals'

function browserBoundary(reduced = false) {
  const animation = { cancel: vi.fn(), onfinish: null, oncancel: null }
  class Card {
    animate = vi.fn((..._args: unknown[]) => animation)
    matches = () => true
    querySelectorAll = () => []
    contains = vi.fn(() => false)
  }
  Object.defineProperty(Card.prototype, 'animate', { value: () => animation, writable: true })
  const card = new Card()
  const preference = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn()
  let intersect: (entries: { target: Card; isIntersecting: boolean }[]) => void
  let mutate: (records: { addedNodes: Card[]; removedNodes: Card[] }[]) => void
  const mutationDisconnect = vi.fn()
  const document = { body: card, hidden: false, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  class IntersectionObserver {
    observe = observe
    unobserve = unobserve
    disconnect = disconnect
    constructor(callback: typeof intersect) { intersect = callback }
  }
  vi.stubGlobal('Element', Card)
  vi.stubGlobal('IntersectionObserver', IntersectionObserver)
  vi.stubGlobal('MutationObserver', class {
    observe = vi.fn()
    disconnect = mutationDisconnect
    constructor(callback: typeof mutate) { mutate = callback }
  })
  vi.stubGlobal('window', { matchMedia: () => preference, IntersectionObserver })
  vi.stubGlobal('document', document)
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '0.6' }))
  return {
    card, preference, document, animation, observe, disconnect, mutationDisconnect,
    enter: () => intersect([{ target: card, isIntersecting: true }]),
    leave: () => intersect([{ target: card, isIntersecting: false }]),
    add: () => mutate([{ addedNodes: [new Card()], removedNodes: [] }]),
    reduce: () => { preference.matches = true; preference.addEventListener.mock.calls[0][1]() },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('progressive scroll motion', () => {
  it('leaves initially visible content steady', () => {
    const browser = browserBoundary()
    startScrollReveals()
    browser.enter()
    expect(browser.card.animate).not.toHaveBeenCalled()
  })

  it('reveals offscreen content without changing its existing dimmed state', () => {
    const browser = browserBoundary()
    startScrollReveals()
    browser.leave(); browser.enter()
    expect(browser.card.animate.mock.calls[0]).toEqual([
      [{ opacity: 0.42, transform: 'translateY(6px)' }, { opacity: '0.6', transform: 'translateY(0)' }],
      { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    ])
  })

  it('does not repeat a reveal when a card returns to view', () => {
    const browser = browserBoundary()
    startScrollReveals()
    browser.leave(); browser.enter(); browser.enter()
    expect(browser.card.animate).toHaveBeenCalledTimes(1)
  })

  it('does not observe cards when reduced motion is already enabled', () => {
    const browser = browserBoundary(true)
    startScrollReveals()
    expect(browser.observe).not.toHaveBeenCalled()
  })

  it('cancels active movement when reduced motion is enabled at runtime', () => {
    const browser = browserBoundary()
    startScrollReveals()
    browser.leave(); browser.enter(); browser.reduce()
    expect(browser.animation.cancel).toHaveBeenCalledOnce()
  })

  it('keeps keyboard-focused cards steady', () => {
    const browser = browserBoundary()
    browser.card.contains.mockReturnValue(true)
    startScrollReveals()
    browser.leave(); browser.enter()
    expect(browser.card.animate).not.toHaveBeenCalled()
  })

  it('observes newly fetched cards without a scroll listener', () => {
    const browser = browserBoundary()
    startScrollReveals()
    browser.add()
    expect(browser.observe).toHaveBeenCalledTimes(2)
  })

  it('disconnects observers on unmount', () => {
    const browser = browserBoundary()
    const cleanup = startScrollReveals()
    cleanup?.()
    expect([browser.disconnect.mock.calls.length, browser.mutationDisconnect.mock.calls.length]).toEqual([1, 1])
  })

  it('leaves content alone when animation APIs are unavailable', () => {
    browserBoundary()
    vi.stubGlobal('window', {})
    expect(startScrollReveals()).toBeUndefined()
  })
})
