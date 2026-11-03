'use client'
import { VenueLink } from './venue-link'
import { PlayerDetails, BalancingNote } from './player-details'
import { playerProfileFrom } from '@/lib/club/player-profile'
import { useEffect, useState, type FormEvent } from 'react'
import { act, dateLabel, money, read, timeLabel, upload } from '@/lib/club/client'
import { POSITIONS, POSITION_LABEL, type Booking, type ClubGame, type ClubSession, type PaymentMethod } from '@/lib/club/types'
import { TeammateFields } from './teammates'
import { teammatesFrom } from '@/lib/club/lineup'
import { Empty, ErrorNotice, Modal } from './primitives'

export function Registration({ game, session, booking: initial, close, done }: { game?: ClubGame; session: ClubSession; booking?: Booking; close: () => void; done: (booking: Booking) => void }) {
  const [booking, setBooking] = useState(initial), [kind, setKind] = useState<'individual' | 'team'>('individual')
  const [position, setPosition] = useState(POSITIONS.find(p => game?.positions.some(s => s.position === p && s.available > 0)) || 'open')
  const [methods, setMethods] = useState<PaymentMethod[]>([]), [method, setMethod] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null)
  const [now, setNow] = useState(() => Date.now()), [loaded, setLoaded] = useState(false)
  useEffect(() => { read<PaymentMethod[]>('methods').then(value => { setMethods(value); setMethod(value[0]?.id || '') }).catch(setError).finally(() => setLoaded(true)) }, [])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const availableTeam = game && (game.available_teams === undefined || game.available_teams > 0) && POSITIONS.every(p => (game.positions.find(s => s.position === p)?.available || 0) >= (p === 'open' || p === 'middle' ? 2 : 1))
  const remaining = booking ? Math.min(600, Math.max(0, Math.ceil((Date.parse(booking.expires_at) - now) / 1000))) : 600
  async function hold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      const result = await act<{ booking: Booking }>('booking.hold', { ...playerProfileFrom(form), game_id: game?.id, kind, position, name: form.get('name'), contact: form.get('contact'), ...(kind === 'team' ? { teammates: teammatesFrom(form, position) } : {}) })
      setBooking(result.booking)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  async function receipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!booking) return; setBusy(true); setError(null)
    const data = new FormData(event.currentTarget); data.set('kind', 'receipt'); data.set('booking', booking.id); data.set('method', method)
    try { await upload(data); done(booking) } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const selected = methods.find(m => m.id === method)
  const startsAt = game?.starts_at || booking?.starts_at
  const endsAt = game?.ends_at || booking?.ends_at
  return <Modal title={booking ? 'Payment' : 'Register'} close={close}>
    <div className="club-game-summary"><strong><VenueLink name={game?.venue || booking?.venue || 'Venue'} mapsUrl={game?.maps_url || booking?.maps_url} /></strong>{startsAt && <p><span>{dateLabel(startsAt)}</span><span>{timeLabel(startsAt)}{endsAt && `–${timeLabel(endsAt)}`}</span></p>}</div>
    <ErrorNotice error={error} />
    {!booking ? <form onSubmit={hold} className="club-form">
      {!session.user && <div className="club-inline"><span>Continue as guest</span><a className="club-button" href="/api/club/auth?start=google">Sign in with Google</a></div>}
      <fieldset className="club-choice"><legend className="club-sr-only">Registration</legend><label><input type="radio" name="registration-kind" value="individual" checked={kind === 'individual'} onChange={() => setKind('individual')} /> Individual</label><label><input type="radio" name="registration-kind" value="team" checked={kind === 'team'} disabled={!availableTeam} onChange={() => setKind('team')} /> Team of 6</label></fieldset>
      <label>Position<select value={position} onChange={e => setPosition(e.target.value as typeof position)}>{POSITIONS.map(p => { const slot = game?.positions.find(s => s.position === p); return <option key={p} value={p} disabled={!slot?.available}>{POSITION_LABEL[p]}{kind === 'individual' ? ` · ${money(slot?.price || 0)}` : ''}{!slot?.available ? ' · Full' : ''}</option> })}</select></label>
      <label>Name<input name="name" autoComplete="name" required maxLength={100} defaultValue={session.user?.name || ''} /></label>
      <label>Email or phone<input name="contact" required minLength={3} maxLength={160} defaultValue={session.user?.email || ''} /></label>
      <PlayerDetails /><BalancingNote />
      {kind === 'team' && <TeammateFields position={position} />}
      <div className="club-total"><span>{kind === 'team' ? 'Team total' : 'Total'}</span><strong>{money(kind === 'team' ? game?.team_price || 0 : game?.positions.find(s => s.position === position)?.price || 0)}</strong></div>
      {!session.user && <small className="club-note">Guest bookings stay in this browser. Keep your booking ID.</small>}
      <button className="club-button primary" disabled={busy || !loaded || !methods.length}>{busy ? 'Reserving…' : 'Continue to payment'}</button>
      {loaded && !methods.length && <p className="club-note">Registration opens once the club adds a payment method.</p>}
    </form> : <form onSubmit={receipt} className="club-form">
      <div className="club-inline"><strong>{money(booking.amount)}</strong><span className={remaining ? 'club-badge' : 'club-badge danger'} aria-live={remaining === 0 ? 'polite' : 'off'}>{remaining ? `Held for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Hold expired'}</span></div>
      {remaining ? <>
        <label>Pay to<select value={method} onChange={e => setMethod(e.target.value)} required>{methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        {selected && <div className="club-bank"><strong>{selected.account_name}</strong><p>{selected.account_number}</p>{selected.qr_path && <img className="club-qr" width={240} height={240} src={`/api/club/asset?kind=qr&id=${selected.id}`} alt={`${selected.label} payment QR`} />}</div>}
        <label>Receipt<input name="file" type="file" required accept="image/png,image/jpeg,image/webp" /><small>PNG, JPEG or WebP · up to 3 MB</small></label>
        <p className="club-note">Submitting reserves your spot. Admin will review your payment.</p>
        <button className="club-button primary" disabled={busy || !method}>{busy ? 'Uploading…' : 'Reserve'}</button>
      </> : <Empty>Your hold has expired. Close this window and register again.</Empty>}
      <small className="club-note">Booking ID: <code>{booking.id}</code></small>
    </form>}
  </Modal>
}
