'use client'
import { VenueLink } from './venue-link'
import { PlayerDetails, BalancingNote } from './player-details'
import { playerProfileFrom } from '@/lib/club/player-profile'
import { useState, type FormEvent } from 'react'
import { act, dateLabel, money, upload } from '@/lib/club/client'
import { POSITIONS, POSITION_LABEL, type ClubGame, type ClubPosition, type PaymentMethod, type Venue } from '@/lib/club/types'
import { TeammateFields } from './teammates'
import { lineupTeamCount, teammatesFrom } from '@/lib/club/lineup'
import { ErrorNotice, Modal, Warning } from './primitives'

function localTime(value?: string) { return value ? new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16) : '' }
export function GameEditor({ game, venues = [], close, saved }: { game?: ClubGame; venues?: Venue[]; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [venueId, setVenueId] = useState(game?.venue_id || '')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError(null)
    const positions = Object.fromEntries(POSITIONS.map(p => [p, { capacity: Number(form.get(`${p}-capacity`)), price: Math.round(Number(form.get(`${p}-price`)) * 100) }]))
    try {
      await act('game.save', { ...(game ? { id: game.id } : {}), venue_id: form.get('venue_id'), team_count: Number(form.get('team_count')), starts_at: `${form.get('start')}:00+08:00`, ends_at: `${form.get('end')}:00+08:00`, status: form.get('status'), team_price: Math.round(Number(form.get('team_price')) * 100), positions, confirm_change: form.get('confirm') === 'on' })
      saved()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return <Modal title={game ? 'Edit game' : 'New game'} close={close}><ErrorNotice error={error} /><form className="club-form" onSubmit={submit}>
    <label>Venue<select name="venue_id" required value={venueId} onChange={event => setVenueId(event.target.value)}><option value="" disabled>Choose venue</option>{venues.filter(venue => venue.enabled || venue.id === game?.venue_id).map(venue => <option key={venue.id} value={venue.id}>{venue.name} · {venue.city}{!venue.enabled ? ' (archived)' : ''}</option>)}</select></label><VenueLink name={venues.find(venue => venue.id === venueId)?.name || 'Venue'} mapsUrl={venues.find(venue => venue.id === venueId)?.maps_url} label="Open in Google Maps" />{!venues.length && <Warning>Add a venue under Venues first.</Warning>}
    <label>Teams<input name="team_count" type="number" min={1} max={20} required defaultValue={game ? lineupTeamCount(game) : 4} onChange={event => { const count = Number(event.target.value); if (count < 1 || count > 20) return; for (const position of POSITIONS) { const field = event.currentTarget.form?.elements.namedItem(`${position}-capacity`); if (field instanceof HTMLInputElement) field.value = String(count * (position === 'open' || position === 'middle' ? 2 : 1)) } }} /></label>
    <div className="club-form-grid"><label>Start · Manila time<input type="datetime-local" name="start" required defaultValue={localTime(game?.starts_at)} /></label><label>End · Manila time<input type="datetime-local" name="end" required defaultValue={localTime(game?.ends_at)} /></label></div>
    <div className="club-position-editor"><div>Position</div><div>Capacity</div><div>PHP / player</div>{POSITIONS.map(p => { const entry = game?.positions.find(s => s.position === p); return <div className="club-position-editor-row" key={p}><span>{POSITION_LABEL[p]}</span><input aria-label={`${POSITION_LABEL[p]} capacity`} name={`${p}-capacity`} type="number" required min={0} max={120} defaultValue={entry?.capacity ?? (p === 'open' || p === 'middle' ? 8 : 4)} /><input aria-label={`${POSITION_LABEL[p]} price`} name={`${p}-price`} type="number" required min={0} max={1000000} step="0.01" defaultValue={(entry?.price ?? (p === 'setter' ? 25000 : 30000)) / 100} /></div> })}</div>
    <div className="club-form-grid"><label>Team of 6 · total PHP<input name="team_price" type="number" min={0} max={1000000} step="0.01" required defaultValue={(game?.team_price ?? 165000) / 100} /></label>
    <label>Status<select name="status" defaultValue={game?.status || 'draft'}><option value="draft">Draft</option><option value="published">Published</option><option value="completed">Completed</option></select></label></div>
    {game && <label className="club-check"><input name="confirm" type="checkbox" /> I’ve checked this schedule change with registered players.</label>}
    <p className="club-note">Existing registrations stay linked. Capacity cannot go below booked positions.</p><button className="club-button primary" disabled={busy || !venues.length}>{busy ? 'Saving…' : 'Save game'}</button>
  </form></Modal>
}
export function PaymentEditor({ method, close, saved }: { method?: PaymentMethod; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setError(null)
    try {
      let path = f.get('remove_qr') ? null : method?.qr_path || null
      const file = f.get('file')
      if (file instanceof File && file.size) { const data = new FormData(); data.set('kind', 'qr'); data.set('file', file); path = (await upload(data)).path || null }
      await act('payment.save', { ...(method ? { id: method.id } : {}), label: f.get('label'), account_name: f.get('account_name'), account_number: f.get('account_number'), qr_path: path, enabled: f.get('enabled') === 'on' })
      saved()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return <Modal title={method ? 'Edit payment method' : 'Add payment method'} close={close}><ErrorNotice error={error} /><form onSubmit={submit} className="club-form"><label>Method<input name="label" required maxLength={100} placeholder="GCash or bank name" defaultValue={method?.label} /></label><label>Account name<input name="account_name" required maxLength={120} defaultValue={method?.account_name} /></label><label>Account number<input name="account_number" required maxLength={100} defaultValue={method?.account_number} /></label><label>QR image<input type="file" name="file" accept="image/png,image/jpeg,image/webp" /><small>PNG, JPEG or WebP · up to 3 MB</small></label>{method?.qr_path && <label className="club-check"><input type="checkbox" name="remove_qr" /> Remove current QR</label>}<label className="club-check"><input type="checkbox" name="enabled" defaultChecked={method?.enabled ?? true} /> Available to players</label><button className="club-button primary" disabled={busy}>{busy ? 'Saving…' : 'Save method'}</button></form></Modal>
}
export function ManualRegistration({ games, close, saved }: { games: ClubGame[]; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [kind, setKind] = useState('individual'), [position, setPosition] = useState<ClubPosition>('open'), [gameId, setGameId] = useState(games.find(g => g.status === 'published' && Date.parse(g.starts_at) > Date.now())?.id || '')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setError(null)
    try { await act('manual.register', { ...playerProfileFrom(f), game_id: f.get('game'), kind, position: f.get('position'), name: f.get('name'), contact: f.get('contact'), ...(kind === 'team' ? { teammates: teammatesFrom(f, position) } : {}) }); saved() } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return <Modal title="Add registration" close={close}><ErrorNotice error={error} /><form className="club-form" onSubmit={submit}><label>Game<select name="game" required value={gameId} onChange={event => setGameId(event.target.value)}>{games.filter(g => g.status === 'published' && Date.parse(g.starts_at) > Date.now()).map(g => <option key={g.id} value={g.id}>{g.venue} · {dateLabel(g.starts_at)}</option>)}</select></label><VenueLink name={games.find(g => g.id === gameId)?.venue || 'Venue'} mapsUrl={games.find(g => g.id === gameId)?.maps_url} label="Open in Google Maps" /><label>Registration<select value={kind} onChange={e => setKind(e.target.value)}><option value="individual">Individual</option><option value="team">Team of 6</option></select></label>{<label>Position<select name="position" value={position} onChange={event => setPosition(event.target.value as ClubPosition)}>{POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABEL[p]}</option>)}</select></label>}<label>Name<input name="name" required maxLength={100} /></label><label>Email or phone<input name="contact" required minLength={3} maxLength={160} /></label><PlayerDetails /><BalancingNote />{kind === 'team' && <TeammateFields position={position} />}<p className="club-note">Slots are reserved immediately. Add a receipt under Payments; the registration remains payment pending.</p><button className="club-button primary" disabled={busy}>{busy ? 'Adding…' : 'Add registration'}</button></form></Modal>
}
export function Transfer({ bookingId, games, close, saved }: { bookingId: string; games: ClubGame[]; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [gameId, setGameId] = useState(games.find(g => g.status === 'published' && Date.parse(g.starts_at) > Date.now())?.id || '')
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); try { await act('booking.transfer', { id: bookingId, game_id: f.get('game') }); saved() } catch (e) { setError(e) } finally { setBusy(false) } }
  return <Modal title="Transfer booking" close={close}><ErrorNotice error={error} /><form className="club-form" onSubmit={submit}><label>Move to<select name="game" required value={gameId} onChange={event => setGameId(event.target.value)}>{games.filter(g => g.status === 'published' && Date.parse(g.starts_at) > Date.now()).map(g => <option key={g.id} value={g.id}>{g.venue} · {dateLabel(g.starts_at)} · Team {money(g.team_price)}</option>)}</select></label><VenueLink name={games.find(g => g.id === gameId)?.venue || 'Venue'} mapsUrl={games.find(g => g.id === gameId)?.maps_url} label="Open in Google Maps" /><p className="club-note">The new game must have enough positions and the same price. Names stay; lineup assignments are cleared.</p><button className="club-button primary" disabled={busy}>Transfer</button></form></Modal>
}
