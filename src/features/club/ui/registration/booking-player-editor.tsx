'use client'
import { useRef, useState, type FormEvent } from 'react'
import { act } from '@/features/club/api/client'
import { editablePlayer, playerEditBlock, playerEditPayload } from '@/features/club/model/booking-player-edit'
import { dateLabel, timeLabel } from '@/features/club/model/format'
import { POSITION_LABEL, type Booking, type RosterEntry } from '@/features/club/model/types'
import { ErrorNotice, Modal } from '../shared/primitives'
import { RequiredNote } from '../shared/required'
import { CheckoutPlayer } from './checkout-player'
import { confirmedPlayerUpdate, PlayerUpdateUnknown } from './booking-player-request'

export function BookingPlayerEditor({ booking, now, close, saved }: {
  booking: Booking; now: number; close: (refresh?: boolean) => void; saved: () => void
}) {
  const entries = booking.entries || []
  const [selected, setSelected] = useState(entries[0]?.id || '')
  const [drafts, setDrafts] = useState(() => Object.fromEntries(entries.map(entry => [entry.id, editablePlayer(entry)])))
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const inFlight = useRef(false)
  const entry = entries.find(entry => entry.id === selected), player = drafts[selected]
  const blocked = playerEditBlock(booking, now)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || unconfirmed || blocked || !entry || !player) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const payload = playerEditPayload(booking, entry, player)
      await confirmedPlayerUpdate(signal => act<{ entry: RosterEntry }>('booking.player.update', payload, signal), payload)
      saved()
    } catch (failure) { setError(failure); if (failure instanceof PlayerUpdateUnknown) setUnconfirmed(true) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <Modal title="Edit player details" close={() => close(unconfirmed)} dismissible={!busy}>
    <p>{booking.venue} · {booking.starts_at && dateLabel(booking.starts_at)} · {booking.starts_at && timeLabel(booking.starts_at)}</p>
    <p className="club-note">Player details lock one hour before the game. Positions and booking prices stay the same.</p>
    <ErrorNotice error={error} />
    {unconfirmed && <button type="button" className="club-button" onClick={() => close(true)}>Close and refresh bookings</button>}
    {blocked && <p className="club-selection-warning" role="status">{blocked}</p>}
    {!entries.length ? <p>No player entries are available. Refresh your bookings.</p> : <form className="club-form" onSubmit={submit}>
      <RequiredNote />
      {entries.length > 1 && <label><span>Choose player</span><select aria-label="Choose player" value={selected} disabled={busy || unconfirmed} onChange={event => { setSelected(event.target.value); setError(null) }}>{entries.map((row, index) => <option key={row.id} value={row.id}>Player {index + 1} · {row.name || 'Position only'} · {POSITION_LABEL[row.position]}</option>)}</select></label>}
      {entry && player && <fieldset disabled={busy || unconfirmed || Boolean(blocked)} className="club-checkout-organizer">
        <CheckoutPlayer key={entry.id} player={player} index={entries.indexOf(entry)} kind={booking.kind} organizerName={booking.captain_name} game={{ id: booking.game_id, starts_at: booking.starts_at!, positions: [] }} positionLocked update={changes => setDrafts(current => ({ ...current, [selected]: { ...current[selected], ...changes } }))} />
        {!player.has_details && (entry.name || entry.birth_date) && <p className="club-note">Saving position only will clear this player's name and personal details. Their position stays reserved.</p>}
      </fieldset>}
      <button className="club-button primary" disabled={busy || unconfirmed || Boolean(blocked) || !entry || !player}>{busy ? 'Saving…' : 'Save player details'}</button>
    </form>}
  </Modal>
}
