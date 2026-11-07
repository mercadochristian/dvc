'use client'
import { useId, useState, type ReactNode } from 'react'
import { money, timeLabel } from '@/features/club/model/format'
import { POSITIONS, POSITION_LABEL, type ClubGame } from '@/features/club/model/types'
import { gameDisplayState } from '@/features/club/model/game-display'
import { VenueLink } from '../shared/venue-link'
export function Price({ amount, regular }: { amount: number; regular?: number }) {
  return <span className="club-price">{regular !== undefined && regular > amount && <del aria-label={`Regular price ${money(regular)}`}>{money(regular)}</del>}<span>{money(amount)}</span></span>
}
export function GameCard({ game, register, players, actions, selection, unavailable = false, inDialog = false, now = Date.now() }: { game: ClubGame; register?: () => void; players: () => void; actions?: ReactNode; selection?: ReactNode; unavailable?: boolean; inDialog?: boolean; now?: number }) {
  const state = gameDisplayState(game, now, unavailable)
  const [expanded, setExpanded] = useState<boolean>()
  const open = inDialog || (expanded ?? state.registerable)
  const detailsId = useId()
  return <article className="club-game-card club-schedule-card" data-collapsed={!open}>
    <header><div className="club-inline"><span className="club-badge neutral">{state.registerable ? `${state.total} slots left` : state.label}</span><span className="club-game-time">{timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</span></div><h3><VenueLink name={game.venue} mapsUrl={game.maps_url} /></h3><p className="club-note">{game.city}</p>{!!game.facilitators?.length && <p className="club-faci-names">Facilitator · {game.facilitators.map(f => f.name).join(', ')}</p>}{!inDialog && <button type="button" className="club-button quiet" aria-expanded={open} aria-controls={detailsId} onClick={() => setExpanded(!open)}>{open ? 'Hide game details' : 'Show game details'}</button>}</header>
    <div id={detailsId} className="club-game-card-details" hidden={!open}>
    <div className="club-position-grid">{POSITIONS.map(position => { const p = game.positions.find(p => p.position === position); return <div key={position}><span>{POSITION_LABEL[position]}</span><strong>{state.showAvailability ? p?.available ? `${p.available} left` : 'Full' : null}</strong><small><Price amount={p?.price || 0} regular={p?.regular_price} /> / player</small></div> })}</div>
    </div>
    <footer hidden={!open && !selection}>
      <div className="club-inline" hidden={!open}>
        <span>Team price</span>
        <strong><Price amount={game.team_price} regular={game.regular_team_price} /> total</strong>
      </div>
      <div className="club-card-actions" data-single-action={!open || (!selection && !register)}>
        {open && <button className="club-button" onClick={players}>Players</button>}
        {selection || (register && <button className="club-button primary" disabled={!state.registerable} onClick={register}>{state.button}</button>)}
      </div>
    </footer>
    {actions && <div className="club-game-operations" hidden={!open}>{actions}</div>}
  </article>
}
