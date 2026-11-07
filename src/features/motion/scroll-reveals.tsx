'use client'

import { useEffect } from 'react'

const cards = '.club-game-card, .club-booking-list > .club-panel, [data-scroll-reveal]'

/** Progressive enhancement: cards remain visible before JS and between observations. */
export function startScrollReveals() {
  if (!window.matchMedia || !window.IntersectionObserver || !Element.prototype.animate) return

  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const seen = new WeakSet<Element>()
  const waiting = new Set<Element>()
  const animations = new Set<Animation>()
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      // Initially visible cards need no entrance; only reveal cards reached by scrolling.
      if (!entry.isIntersecting) { waiting.add(entry.target); continue }
      observer.unobserve(entry.target)
      if (!waiting.delete(entry.target) || preference.matches || document.hidden || entry.target.contains(document.activeElement)) continue
      const opacity = getComputedStyle(entry.target).opacity
      const animation = entry.target.animate([
        { opacity: Number(opacity) * 0.7, transform: 'translateY(6px)' },
        { opacity, transform: 'translateY(0)' },
      ], { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      animations.add(animation)
      animation.onfinish = animation.oncancel = () => { animations.delete(animation) }
    }
  })

  const visit = (node: Node, callback: (element: Element) => void) => {
    if (!(node instanceof Element)) return
    if (node.matches(cards)) callback(node)
    node.querySelectorAll(cards).forEach(callback)
  }
  const observe = (element: Element) => {
    if (seen.has(element) || preference.matches) return
    seen.add(element)
    observer.observe(element)
  }
  const cancel = () => { animations.forEach(animation => animation.cancel()); animations.clear() }
  const onPreferenceChange = () => {
    cancel()
    observer.disconnect()
    waiting.clear()
    if (!preference.matches) visit(document.body, observe)
  }
  const onVisibilityChange = () => { if (document.hidden) cancel() }
  const mutations = new MutationObserver(records => {
    for (const record of records) {
      record.removedNodes.forEach(node => visit(node, element => {
        observer.unobserve(element)
        waiting.delete(element)
      }))
      record.addedNodes.forEach(node => visit(node, observe))
    }
  })
  visit(document.body, observe)
  mutations.observe(document.body, { childList: true, subtree: true })
  preference.addEventListener('change', onPreferenceChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    mutations.disconnect()
    observer.disconnect()
    cancel()
    preference.removeEventListener('change', onPreferenceChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

export function ScrollReveals() {
  useEffect(startScrollReveals, [])
  return null
}
