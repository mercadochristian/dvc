'use client'

import { useEffect, useRef, useState } from 'react'

type Options = {
  /** Pixels to pull before release triggers a refresh. Default 80. */
  threshold?: number
  /** Max visual pull distance in pixels. Default 120. */
  maxPull?: number
  /** Resistance multiplier on raw touch delta. Default 0.5. */
  damping?: number
  /** Disable the hook entirely (e.g. on desktop). Default false. */
  disabled?: boolean
}

export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  options: Options = {},
) {
  const {
    threshold = 80,
    maxPull = 120,
    damping = 0.5,
    disabled = false,
  } = options

  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Keep the latest onRefresh in a ref so touch listeners don't need to re-bind.
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return

    let startY: number | null = null
    let currentPull = 0
    let refreshing = false

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || refreshing) return
      startY = e.touches[0].clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null || refreshing) return
      const delta = e.touches[0].clientY - startY
      if (delta <= 0) {
        if (currentPull !== 0) {
          currentPull = 0
          setPullDistance(0)
        }
        return
      }
      currentPull = Math.min(delta * damping, maxPull)
      setPullDistance(currentPull)
      // Block native rubber-band/over-scroll while actively pulling.
      if (currentPull > 10 && e.cancelable) e.preventDefault()
    }

    const onTouchEnd = async () => {
      if (startY === null) return
      startY = null
      if (currentPull >= threshold && !refreshing) {
        refreshing = true
        setIsRefreshing(true)
        // Snap to threshold while the refresh runs.
        currentPull = threshold
        setPullDistance(threshold)
        try {
          await onRefreshRef.current()
        } finally {
          refreshing = false
          currentPull = 0
          setIsRefreshing(false)
          setPullDistance(0)
        }
      } else {
        currentPull = 0
        setPullDistance(0)
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [disabled, threshold, maxPull, damping])

  return { pullDistance, isRefreshing, threshold }
}
