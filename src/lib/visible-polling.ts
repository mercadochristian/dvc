export const LIVE_REFRESH_INTERVAL = 15_000

/** Refresh visible screens without overlapping requests; cleanup stops future work. */
export function startVisiblePolling(
  refresh: () => Promise<void>,
  source: Document = document,
): () => void {
  let running = false
  let stopped = false
  const poll = () => {
    if (stopped || running || source.visibilityState !== 'visible') return
    running = true
    void Promise.resolve().then(() => {
      if (!stopped && source.visibilityState === 'visible') return refresh()
    }).catch(() => {}).finally(() => { running = false })
  }
  const interval = setInterval(poll, LIVE_REFRESH_INTERVAL)
  source.addEventListener('visibilitychange', poll)
  return () => {
    stopped = true
    clearInterval(interval)
    source.removeEventListener('visibilitychange', poll)
  }
}
