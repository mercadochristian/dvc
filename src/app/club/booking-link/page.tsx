'use client'
import { useEffect, useRef, useState } from 'react'
import { dateLabel, timeLabel } from '@/features/club/model/format'

type Game = { id: string; venue: string; starts_at: string; ends_at: string }
type State = { outcome: 'guest'; games: Game[] } |
  { outcome: 'loading' | 'linked' | 'unavailable' | 'email_mismatch' | 'conflict' | 'error' }

export default function BookingLinkPage() {
  const [state, setState] = useState<State>({ outcome: 'loading' })
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [accountError, setAccountError] = useState(false)
  const token = useRef<string | undefined>(undefined)
  const started = useRef(false)

  async function openBooking() {
    setState({ outcome: 'loading' })
    try {
      const response = await fetch('/api/club/booking-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.current }),
      })
      const result = await response.json() as State | null
      const knownOutcome = result && (
        (result.outcome === 'guest' && Array.isArray(result.games)) ||
        result.outcome === 'linked' || result.outcome === 'email_mismatch' ||
        result.outcome === 'conflict' || result.outcome === 'unavailable'
      )
      if (!knownOutcome || !result) {
        setState({ outcome: 'error' })
        return
      }
      if (token.current) {
        window.history.replaceState(null, '', window.location.pathname)
        token.current = undefined
      }
      setState(result)
    } catch {
      setState({ outcome: 'error' })
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    token.current = window.location.hash.slice(1) || undefined
    void openBooking()
  }, [])

  async function switchAccount() {
    if (switchingAccount) return
    setSwitchingAccount(true)
    setAccountError(false)
    try {
      const response = await fetch('/api/club/auth', { method: 'POST' })
      if (!response.ok) throw new Error('Sign-out failed')
      window.location.assign('/club/sign-in?booking=1')
    } catch {
      setAccountError(true)
      setSwitchingAccount(false)
    }
  }

  return <main className="club-app club-booking-link-page">
    <section className="club-panel club-booking-link-panel" aria-labelledby="booking-link-heading">
      <h1 id="booking-link-heading">Your DVC booking</h1>
      {state.outcome === 'loading' && <p role="status">Opening your booking…</p>}
      {state.outcome === 'guest' && <>
        <div><span className="club-badge">Reserved</span></div>
        <ul className="club-booking-roster" aria-label="Games in this checkout">
          {state.games.map(game => <li className="club-entry" key={game.id}>
            <strong>{game.venue}</strong><br />
            {dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}
          </li>)}
        </ul>
        <p className="club-note">Sign in with the email you used to book to save these games to your account.</p>
        <a className="club-button primary" href="/club/sign-in?booking=1">Sign in to save this booking</a>
      </>}
      {state.outcome === 'linked' && <>
        <p role="status">Booking saved to your account.</p>
        <a className="club-button primary" href="/club?view=bookings">Open My bookings</a>
      </>}
      {state.outcome === 'email_mismatch' && <>
        <p>This booking uses a different email or your account email hasn’t been verified. Sign in with the verified email used to book.</p>
        {accountError && <p className="club-error" role="alert">Couldn’t sign out. Try switching accounts again.</p>}
        <div className="club-actions"><button type="button" className="club-button primary" disabled={switchingAccount}
          onClick={() => void switchAccount()}>{switchingAccount ? 'Signing out…' : 'Use another account'}</button></div>
      </>}
      {state.outcome === 'conflict' && <p>We couldn’t save this booking to your account. Contact DVC for help.</p>}
      {state.outcome === 'unavailable' && <p>This link has expired or is no longer available. If you already saved the booking, open <a href="/club?view=bookings">My bookings</a>.</p>}
      {state.outcome === 'error' && <>
        <p role="alert">We couldn’t open your booking. Please try again.</p>
        <button type="button" className="club-button" onClick={() => void openBooking()}>Try again</button>
      </>}
    </section>
  </main>
}
