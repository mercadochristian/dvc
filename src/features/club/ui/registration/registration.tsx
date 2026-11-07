'use client'
import { useEffect, useState, type FormEvent } from 'react'
import { VenueLink } from '../shared/venue-link'
import { PlayerDetails, BalancingNote } from './player-details'
import { act, read, upload } from '@/features/club/api/client'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { holdSecondsRemaining, registrationDraft, type RegistrationDraft } from '@/features/club/model/registration-summary'
import { POSITIONS, POSITION_LABEL, type Booking, type ClubGame, type ClubPosition, type ClubSession, type PaymentMethod, type RegistrationProfile } from '@/features/club/model/types'
import { TeammateFields } from './teammates'
import { Empty, ErrorNotice, Modal } from '../shared/primitives'
import { RequiredLabel, RequiredNote } from '../shared/required'

export function RegistrationReview({ draft, busy, edit, confirm }: { draft: RegistrationDraft; busy: boolean; edit: () => void; confirm: () => void }) {
  return <section className="club-form" aria-label="Registration review">
    <h3>Review your registration</h3>
    <div><strong>{draft.data.organizer_plays ? 'Registrant' : 'Organizer (not playing)'}</strong><p>{draft.data.name}</p><p className="club-note">{draft.data.contact}{draft.data.contact !== draft.data.organizer_email && ` · ${draft.data.organizer_email}`}</p></div>
    <div><strong>{draft.data.kind === 'team' ? 'Team of 6' : 'Individual'}</strong>{draft.players.map((player, index) => <p className="club-entry" key={index}>{player.name || 'Player to be named'} · {POSITION_LABEL[player.position]}</p>)}</div>
    <div className="club-total"><span>Total</span><strong>{money(draft.amount)}</strong></div>
    <p className="club-note">No slots are held yet. Continue to payment to check availability and start your ten-minute hold.</p>
    <div className="club-actions"><button type="button" className="club-button" disabled={busy} onClick={edit}>Edit details</button><button type="button" className="club-button primary" disabled={busy} onClick={confirm}>{busy ? 'Reserving…' : 'Continue to payment'}</button></div>
  </section>
}

export function Registration({ game, session, booking: initial, close, done }: { game?: ClubGame; session: ClubSession; booking?: Booking; close: () => void; done: (booking: Booking) => void }) {
  const [booking, setBooking] = useState(initial), [kind, setKind] = useState<'individual' | 'team'>('individual')
  const [position, setPosition] = useState<ClubPosition>(POSITIONS.find(p => game?.positions.some(s => s.position === p && s.available > 0)) || 'open')
  const [organizerPlays, setOrganizerPlays] = useState(true), [draft, setDraft] = useState<RegistrationDraft | null>(null)
  const [profile, setProfile] = useState<RegistrationProfile | null>(null), [profileLoaded, setProfileLoaded] = useState(!session.user || !!initial), [profileFailed, setProfileFailed] = useState(false)
  const [methods, setMethods] = useState<PaymentMethod[]>([]), [method, setMethod] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null)
  const [now, setNow] = useState(() => Date.now()), [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let active = true
    read<PaymentMethod[]>('methods').then(value => { if (active) { setMethods(value); setMethod(value[0]?.id || '') } }).catch(error => { if (active) setError(error) }).finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!session.user || initial) return
    let active = true
    read<RegistrationProfile | null>('profile').then(value => {
      if (!active) return
      setProfile(value)
      if (value?.position && game?.positions.some(slot => slot.position === value.position && slot.available > 0)) setPosition(value.position)
    }).catch(() => { if (active) setProfileFailed(true) }).finally(() => { if (active) setProfileLoaded(true) })
    return () => { active = false }
  // The parent remounts registration when the account changes. Fetch once per
  // identity/game so a session refresh cannot overwrite an in-progress edit.
  }, [session.user?.id, initial?.id, game?.id])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const availableTeam = game && (game.available_teams === undefined || game.available_teams > 0) && POSITIONS.every(p => (game.positions.find(s => s.position === p)?.available || 0) >= (p === 'open' || p === 'middle' ? 2 : 1))
  const remaining = booking ? holdSecondsRemaining(booking.expires_at, now) : 600
  const plays = kind === 'individual' || organizerPlays
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!game) return; setError(null)
    try { setDraft(registrationDraft(new FormData(event.currentTarget), game, kind, position, plays)) } catch (error) { setError(error) }
  }
  async function hold() {
    if (!draft || busy) return; setBusy(true); setError(null)
    try { const result = await act<{ booking: Booking }>('booking.hold', draft.data); setBooking(result.booking); setNow(Date.now()); setDraft(null) }
    catch (error) { setError(error) } finally { setBusy(false) }
  }
  async function receipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!booking) return; setBusy(true); setError(null)
    const data = new FormData(event.currentTarget); data.set('kind', 'receipt'); data.set('booking', booking.id); data.set('method', method)
    try { await upload(data); done(booking) } catch (error) { setError(error) } finally { setBusy(false) }
  }
  const selected = methods.find(m => m.id === method), slot = game?.positions.find(s => s.position === position)
  const startsAt = game?.starts_at || booking?.starts_at, endsAt = game?.ends_at || booking?.ends_at
  return <Modal title={booking ? 'Payment' : draft ? 'Review registration' : 'Register'} close={close}>
    <div className="club-game-summary"><strong><VenueLink name={game?.venue || booking?.venue || 'Venue'} mapsUrl={game?.maps_url || booking?.maps_url} /></strong>{startsAt && <p><span>{dateLabel(startsAt)}</span><span>{timeLabel(startsAt)}{endsAt && `–${timeLabel(endsAt)}`}</span></p>}</div>
    <ErrorNotice error={error} />
    {!booking ? !profileLoaded ? <Empty>Loading saved player details…</Empty> : <>
      {draft && <RegistrationReview draft={draft} busy={busy} edit={() => { setDraft(null); setError(null) }} confirm={() => void hold()} />}
      <form onSubmit={review} className="club-form" hidden={!!draft} style={draft ? { display: 'none' } : undefined}>
        <RequiredNote />
        {!session.user && <div className="club-inline"><span>Continue as guest</span><a className="club-button" href="/club/sign-in">Sign in</a></div>}
        {profileFailed && <p className="club-note" role="status">Saved player details could not be loaded. You can enter them below.</p>}
        <fieldset className="club-choice"><legend className="club-sr-only">Registration</legend><label><input type="radio" name="registration-kind" value="individual" checked={kind === 'individual'} onChange={() => setKind('individual')} /> Individual</label><label><input type="radio" name="registration-kind" value="team" checked={kind === 'team'} disabled={!availableTeam} onChange={() => setKind('team')} /> Team of 6</label></fieldset>
        {kind === 'team' && <label className="club-check"><input type="checkbox" checked={organizerPlays} onChange={event => setOrganizerPlays(event.target.checked)} /> I am also playing</label>}
        <label><RequiredLabel>{plays ? 'Name' : 'Organizer name'}</RequiredLabel><input name="name" autoComplete="name" required maxLength={100} defaultValue={profile?.name || session.user?.name || ''} /></label>
        <label><RequiredLabel>Email or phone</RequiredLabel><input name="contact" required minLength={3} maxLength={160} defaultValue={profile?.contact || session.user?.email || ''} /></label>
        <label><RequiredLabel>Confirmation email</RequiredLabel><input name="organizer_email" type="email" autoComplete="email" required maxLength={254} defaultValue={session.user?.email || ''} /><small>We send your reservation and schedule confirmation here.</small></label>
        {plays && <><label><RequiredLabel>Position</RequiredLabel><select value={position} onChange={event => setPosition(event.target.value as ClubPosition)} required>{POSITIONS.map(p => { const slot = game?.positions.find(s => s.position === p); return <option key={p} value={p} disabled={!slot?.available}>{POSITION_LABEL[p]}{kind === 'individual' ? ` · ${money(slot?.discount_price ?? slot?.price ?? 0)}` : ''}{!slot?.available ? ' · Full' : ''}</option> })}</select></label><PlayerDetails value={profile || undefined} gameDate={startsAt} /><BalancingNote /></>}
        {kind === 'team' && <TeammateFields position={plays ? position : null} gameDate={startsAt} />}
        {!plays && <p className="club-note">Your organizer details do not occupy a player slot. All six team positions are reserved for your players.</p>}
        <div className="club-total"><span>{kind === 'team' ? 'Team total' : 'Total'}</span><strong>{money(kind === 'team' ? game?.team_discount_price ?? game?.team_price ?? 0 : slot?.discount_price ?? slot?.price ?? 0)}</strong></div>
        {!session.user && <small className="club-note">Guest bookings stay in this browser. Keep your booking ID.</small>}
        <button className="club-button primary" disabled={busy || !loaded || !methods.length}>Review registration</button>
        {loaded && !methods.length && <p className="club-note">Registration opens once the club adds a payment method.</p>}
      </form>
    </> : <form onSubmit={receipt} className="club-form">
      <RequiredNote />
      <div className="club-inline"><strong>{money(booking.amount)}</strong><span className={remaining ? 'club-badge' : 'club-badge danger'} aria-live={remaining === 0 ? 'polite' : 'off'}>{remaining ? `Held for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Hold expired'}</span></div>
      {remaining ? <>
        <label><RequiredLabel>Pay to</RequiredLabel><select value={method} onChange={event => setMethod(event.target.value)} required>{methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        {selected && <div className="club-bank"><strong>{selected.account_name}</strong><p>{selected.account_number}</p>{selected.qr_path && <img className="club-qr" width={240} height={240} src={`/api/club/asset?kind=qr&id=${selected.id}`} alt={`${selected.label} payment QR`} />}</div>}
        <label><RequiredLabel>Receipt</RequiredLabel><input name="file" type="file" required accept="image/png,image/jpeg,image/webp" /><small>PNG, JPEG or WebP · up to 3 MB</small></label>
        <p className="club-note">Submitting reserves your spot. Admin will review your payment. Confirmation email delivery does not affect the reservation.</p>
        <button className="club-button primary" disabled={busy || !method}>{busy ? 'Uploading…' : 'Reserve'}</button>
      </> : <Empty>Your hold has expired. Close this window and register again.</Empty>}
      <small className="club-note">Booking ID: <code>{booking.id}</code></small>
    </form>}
  </Modal>
}
