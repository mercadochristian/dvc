'use client'
import { RequiredLabel, RequiredMark, RequiredNote } from '../shared/required'
import { VenueLink } from '../shared/venue-link'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { act, RequestError } from '@/features/club/api/client'
import { POSITIONS, POSITION_LABEL, type ClubGame, type Venue } from '@/features/club/model/types'
import { lineupTeamCount } from '@/features/club/model/lineup'
import { ErrorNotice, Modal, Warning } from '../shared/primitives'
function localTime(value?: string) { return value ? new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16) : '' }
function submittedTime(value: FormDataEntryValue | null, original?: string) {
  return original && value === localTime(original) ? original : `${value}:00+08:00`
}

export function GameEditor({ game, venues = [], close, saved, moreOptions, optionsState }: { game?: ClubGame; venues?: Venue[]; close: () => void; saved: () => void; moreOptions?: ReactNode; optionsState?: ReactNode }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [venueId, setVenueId] = useState(game?.venue_id || '')
  const [start, setStart] = useState(() => localTime(game?.starts_at))
  const [end, setEnd] = useState(() => localTime(game?.ends_at))
  const eligibleVenues = venues.filter(venue => venue.enabled || venue.id === game?.venue_id)
  const selectedVenue = eligibleVenues.find(venue => venue.id === venueId)
  const timeChanged = Boolean(game && (start !== localTime(game.starts_at) || end !== localTime(game.ends_at)))
  const scheduleChanged = timeChanged || Boolean(game && selectedVenue && selectedVenue.name !== game.venue)
  const pending = useRef(false)
  const creationRequest = useRef<string | null>(null)
  const uncertainCreate = useRef<Record<string, unknown> | null>(null)
  const checking = Boolean(uncertainCreate.current)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending.current) return
    const form = new FormData(e.currentTarget)
    pending.current = true
    setBusy(true)
    setError(null)
    const positions = Object.fromEntries(POSITIONS.map(p => [p, { capacity: Number(form.get(`${p}-capacity`)), price: Math.round(Number(form.get(`${p}-price`)) * 100), discount_price: String(form.get(`${p}-discount`) || '').trim() === '' ? null : Math.round(Number(form.get(`${p}-discount`)) * 100) }]))
    try {
      if (uncertainCreate.current) {
        await act('game.save', uncertainCreate.current)
        uncertainCreate.current = null
        saved()
        return
      }
      if (!game && !creationRequest.current) creationRequest.current = crypto.randomUUID()
      const payload = { ...(game ? { id: game.id, expected_start: game.starts_at } : { request_id: creationRequest.current }), venue_id: form.get('venue_id'), team_count: Number(form.get('team_count')), starts_at: submittedTime(form.get('start'), game?.starts_at), ends_at: submittedTime(form.get('end'), game?.ends_at), status: form.get('status'), team_price: Math.round(Number(form.get('team_price')) * 100), team_discount_price: String(form.get('team_discount_price') || '').trim() === '' ? null : Math.round(Number(form.get('team_discount_price')) * 100), positions, confirm_change: form.get('confirm') === 'on' }
      if (!game) uncertainCreate.current = payload
      await act('game.save', payload)
      uncertainCreate.current = null
      saved()
    } catch (error) {
      if (error instanceof RequestError && error.status && error.status < 500) uncertainCreate.current = null
      setError(error)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return <Modal title={game ? 'Edit game' : 'New game'} close={close} dismissible={!busy}><ErrorNotice error={error} />
    {checking && <p className="club-note">The save result is unknown. Check the original save here, or check Games before creating another.</p>}
    {optionsState ?? <form className="club-form" onSubmit={submit}><RequiredNote />
    <label><RequiredLabel>Venue</RequiredLabel>
      <select disabled={busy || checking} name="venue_id" required value={venueId} onChange={event => setVenueId(event.target.value)}>
        <option value="" disabled>Choose venue</option>
        {eligibleVenues.map(venue => <option key={venue.id} value={venue.id}>{venue.name} · {venue.city}{!venue.enabled ? ' (archived)' : ''}</option>)}
      </select>
      {selectedVenue && <small className="club-selected-option" aria-hidden="true">
        {selectedVenue.name} · {selectedVenue.city}{!selectedVenue.enabled ? ' (archived)' : ''}
      </small>}
    </label>
    {selectedVenue?.maps_url && <VenueLink name={selectedVenue.name} mapsUrl={selectedVenue.maps_url} label="Open in Google Maps" />}
    {!eligibleVenues.length && <Warning>No available venues in the loaded options. Load more if available, or enable a venue under Venues.</Warning>}
    {moreOptions}
    <label><RequiredLabel>Teams</RequiredLabel><input disabled={busy || checking} name="team_count" type="number" min={1} max={20} required defaultValue={game ? lineupTeamCount(game) : 4} onChange={event => { const count = Number(event.target.value); if (count < 1 || count > 20) return; for (const position of POSITIONS) { const field = event.currentTarget.form?.elements.namedItem(`${position}-capacity`); if (field instanceof HTMLInputElement) field.value = String(count * (position === 'open' || position === 'middle' ? 2 : 1)) } }} /></label>
    <div className="club-form-grid"><label><RequiredLabel>Start · Manila time</RequiredLabel><input disabled={busy || checking} type="datetime-local" name="start" required value={start} onChange={event => setStart(event.target.value)} /></label><label><RequiredLabel>End · Manila time</RequiredLabel><input disabled={busy || checking} type="datetime-local" name="end" required value={end} onChange={event => setEnd(event.target.value)} /></label></div>
    <div className="club-position-editor"><div>Position</div><div>Capacity</div><div>PHP / player<RequiredMark /></div><div>Discount PHP</div>{POSITIONS.map(p => { const entry = game?.positions.find(s => s.position === p); return <div className="club-position-editor-row" key={p}><span>{POSITION_LABEL[p]}</span>
      <label><span className="club-position-field-caption">Capacity<RequiredMark /></span><input disabled={busy || checking} aria-label={`${POSITION_LABEL[p]} capacity`} name={`${p}-capacity`} type="number" required min={0} max={120} defaultValue={entry?.capacity ?? (p === 'open' || p === 'middle' ? 8 : 4)} /></label>
      <label><span className="club-position-field-caption">PHP / player<RequiredMark /></span><input disabled={busy || checking} aria-label={`${POSITION_LABEL[p]} price`} name={`${p}-price`} type="number" required min={0} max={1000000} step="0.01" defaultValue={(entry?.price ?? (p === 'setter' ? 25000 : 30000)) / 100} /></label>
      <label><span className="club-position-field-caption">Discount PHP</span><input disabled={busy || checking} aria-label={`${POSITION_LABEL[p]} discounted price`} name={`${p}-discount`} type="number" min={0} max={1000000} step="0.01" placeholder="Optional" defaultValue={entry?.discount_price === null || entry?.discount_price === undefined ? '' : entry.discount_price / 100} /></label></div> })}</div>
    <div className="club-form-grid"><label><RequiredLabel>Team price · total PHP</RequiredLabel><input disabled={busy || checking} name="team_price" type="number" min={0} max={1000000} step="0.01" required defaultValue={(game?.team_price ?? 165000) / 100} /></label>
    <label>Discounted team total PHP<input disabled={busy || checking} name="team_discount_price" type="number" min={0} max={1000000} step="0.01" placeholder="Optional" defaultValue={game?.team_discount_price === null || game?.team_discount_price === undefined ? '' : game.team_discount_price / 100} /></label><label>Status<select disabled={busy || checking} name="status" defaultValue={game?.status || 'draft'}><option value="draft">Draft</option><option value="published">Published</option><option value="completed">Completed</option></select></label></div>
    {scheduleChanged && <label className="club-check"><input disabled={busy || checking} name="confirm" type="checkbox" /> I’ve checked this schedule change with registered players.</label>}
    {timeChanged && <p className="club-note">If game emails are enabled, changing the start or end time queues a notice for registered players with an email on file.</p>}
    <p className="club-note">Existing registrations stay linked. Capacity cannot go below booked positions.</p><button className="club-button primary" disabled={busy || (!checking && !eligibleVenues.length)}>{busy ? 'Saving…' : checking ? 'Check original save' : 'Save game'}</button>
  </form>}</Modal>
}
