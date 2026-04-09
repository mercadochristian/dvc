import { describe, it, expect, beforeEach } from 'vitest'
import {
  isRecentlyDismissed,
  markDismissed,
  DISMISS_KEY,
  DISMISS_DAYS,
} from '@/lib/install-prompt'

describe('install-prompt helpers', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      clear: () => {
        store.clear()
      },
      key: () => null,
      get length() {
        return store.size
      },
    }
  })

  it('returns false when nothing is stored', () => {
    expect(isRecentlyDismissed()).toBe(false)
  })

  it('returns true immediately after markDismissed()', () => {
    markDismissed()
    expect(isRecentlyDismissed()).toBe(true)
  })

  it('returns false after DISMISS_DAYS have elapsed', () => {
    const past = Date.now() - (DISMISS_DAYS + 1) * 24 * 60 * 60 * 1000
    localStorage.setItem(DISMISS_KEY, String(past))
    expect(isRecentlyDismissed()).toBe(false)
  })

  it('returns false when stored value is corrupted', () => {
    localStorage.setItem(DISMISS_KEY, 'not-a-number')
    expect(isRecentlyDismissed()).toBe(false)
  })
})
