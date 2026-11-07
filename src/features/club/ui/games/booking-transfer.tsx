'use client'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { act } from '@/features/club/api/client'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import type { Booking, ClubGame } from '@/features/club/model/types'
import { ErrorNotice, Modal } from '../shared/primitives'
import { RequiredLabel } from '../shared/required'
import { VenueLink } from '../shared/venue-link'

export type TransferGame = Pick<ClubGame, 'id' | 'venue' | 'starts_at' | 'status' | 'maps_url'>

export function Transfer({ booking, games, close, saved, moreOptions, optionsState }: {
  booking: Booking; games: TransferGame[]; close: () => void; saved: () => void; moreOptions?: ReactNode; optionsState?: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [gameId, setGameId] = useState('')
  const pending = useRef(false)
  const source = games.find(game => game.id === booking.game_id)
  const sourceVenue = source?.venue ?? booking.venue
  const sourceStart = source?.starts_at ?? booking.starts_at
  const destinations = games.filter(game => game.id !== booking.game_id && game.status === 'published' && Date.parse(game.starts_at) > Date.now())
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  const target = destinations.find(game => game.id === gameId)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await act('booking.transfer', { id: booking.id, game_id: target.id })
      saved()
    } catch (error) {
      setError(error)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <Modal title="Transfer booking" close={close} dismissible={!busy}>
    <div className="club-confirm-summary">
      <strong>{booking.captain_name}</strong>
      {sourceVenue && <span>From {sourceVenue}{sourceStart && ` · ${dateLabel(sourceStart)} · ${timeLabel(sourceStart)}`}</span>}
      <span>Booking amount · {money(booking.amount)}</span>
    </div>
    <ErrorNotice error={error} />
    {moreOptions}
    {optionsState ?? (destinations.length ? <form className="club-form" onSubmit={submit}>
      <label><RequiredLabel>Move to</RequiredLabel>
        <select required aria-describedby="club-transfer-requirements" value={target?.id || ''} disabled={busy} onChange={event => setGameId(event.target.value)}>
          <option value="" disabled>Choose another game</option>
          {destinations.map(game => <option key={game.id} value={game.id}>
            {game.venue} · {dateLabel(game.starts_at)} · {timeLabel(game.starts_at)}
          </option>)}
        </select>
      </label>
      {target && <div className="club-confirm-summary">
        <strong><VenueLink name={target.venue} mapsUrl={target.maps_url} /></strong>
        <span>{dateLabel(target.starts_at)} · {timeLabel(target.starts_at)}</span>
      </div>}
      <p className="club-note" id="club-transfer-requirements">The new game needs enough open positions and the same total price. Players stay on this booking.</p>
      <button type="submit" className="club-button primary" disabled={busy || !target}>{busy ? 'Transferring…' : 'Transfer booking'}</button>
    </form> : <p className="club-note">No other upcoming published games are available.</p>)}
  </Modal>
}
