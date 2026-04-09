export const DISMISS_KEY = 'dvc-install-dismissed-at'
export const DISMISS_DAYS = 14

export function isRecentlyDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export function markDismissed(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // ignore — private browsing / disabled storage
  }
}
