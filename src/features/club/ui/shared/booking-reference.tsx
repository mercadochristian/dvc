'use client'
import { useEffect, useRef, useState } from 'react'

export function BookingReference({ label, value }: { label: string; value: string }) {
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'manual'>('ready')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const short = value.length > 8 ? `${value.slice(0, 8)}…` : value
  const copyLabel = `Copy ${label.toLowerCase()}`

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(value)
      clearTimeout(resetTimer.current)
      setCopyState('copied')
      resetTimer.current = setTimeout(() => setCopyState('ready'), 2000)
    } catch {
      clearTimeout(resetTimer.current)
      setCopyState('manual')
    }
  }

  return <div className="club-booking-reference">
    <small className="club-note">{label}{' '}
      <code>
        <span aria-hidden="true">{copyState === 'manual' ? value : short}</span>
        <span className="club-sr-only">{value}</span>
      </code>
    </small>
    <button
      type="button"
      className="club-reference-copy"
      aria-label={copyLabel}
      title={copyState === 'copied' ? 'Copied' : copyLabel}
      onClick={() => void copyReference()}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copyState === 'copied'
          ? <path d="m5 12 4 4L19 6" />
          : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>}
      </svg>
    </button>
    <span className="club-sr-only" role="status">
      {copyState === 'copied' ? `${label} copied` : copyState === 'manual' ? 'Copy unavailable. The full reference is shown.' : ''}
    </span>
  </div>
}
