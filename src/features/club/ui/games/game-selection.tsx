'use client'
import { dateLabel, timeLabel } from '@/features/club/model/format'
import { canSelectGame, type SelectedGame } from '@/features/club/model/games-selection'
import { gameDisplayState } from '@/features/club/model/game-display'
import type { ClubGame } from '@/features/club/model/types'

function gameLabel(game: ClubGame) { return `${game.venue}, ${dateLabel(game.starts_at)}, ${timeLabel(game.starts_at)}` }

export function GameSelectionControl({ game, selected, toggle, focusRegistration, unavailable = false, now = Date.now() }: { game: ClubGame; selected: boolean; toggle: () => void; focusRegistration?: () => void; unavailable?: boolean; now?: number }) {
  return <><button type="button" className={`club-button club-game-select${selected ? '' : ' primary'}`} aria-pressed={selected} aria-label={`${selected ? 'Selected' : 'Select game'}: ${gameLabel(game)}`} disabled={!selected && (unavailable || !canSelectGame(game, now))} onClick={toggle}>{selected ? 'Selected' : 'Select game'}</button>
    {selected && focusRegistration && <button type="button" className="club-skip" onClick={focusRegistration}>Go to registration controls</button>}
  </>
}

export function SelectedGames({ selected, open, remove, now = Date.now() }: { selected: SelectedGame[]; open: (game: ClubGame) => void; remove: (id: string) => void; now?: number }) {
  return <div className="club-selected-games">
    <p className="club-note">Selecting games does not reserve slots.</p>
    {!selected.length ? <p>No games selected. Select a game from the schedule.</p> : <ul>{selected.map(entry => {
      const unavailable = entry.missing || !canSelectGame(entry.game, now)
      return <li key={entry.game.id}><div><strong>{entry.game.venue}</strong><p className="club-note">{dateLabel(entry.game.starts_at)} · {timeLabel(entry.game.starts_at)}–{timeLabel(entry.game.ends_at)}</p>{unavailable && <p className="club-selection-warning">This game is no longer available for registration ({gameDisplayState(entry.game, now, entry.missing).label}). Remove it or check its details.</p>}</div><div className="club-row-actions"><button type="button" className="club-button" onClick={() => open(entry.game)} aria-label={`Details for ${gameLabel(entry.game)}`}>Details</button><button type="button" className="club-button" onClick={() => remove(entry.game.id)} aria-label={`Remove ${gameLabel(entry.game)}`}>Remove</button></div></li>
    })}</ul>}
  </div>
}
