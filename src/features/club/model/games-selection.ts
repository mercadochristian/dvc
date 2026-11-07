import { manilaDate } from './format'
import { gameDisplayState } from './game-display'
import type { ClubGame } from './types'

export interface SelectedGame { game: ClubGame; missing: boolean }

export function canSelectGame(game: ClubGame, now = Date.now()) {
  return gameDisplayState(game, now).registerable
}

export function toggleSelectedGame(selected: SelectedGame[], game: ClubGame, now = Date.now()): SelectedGame[] {
  if (selected.some(entry => entry.game.id === game.id)) return selected.filter(entry => entry.game.id !== game.id)
  return canSelectGame(game, now) ? [...selected, { game, missing: false }] : selected
}

// A fetched week refreshes matching snapshots, but never removes selections
// from other weeks or silently substitutes a different schedule.
export function refreshSelectedGames(selected: SelectedGame[], games: ClubGame[], from: string, to: string): SelectedGame[] {
  const current = new Map(games.map(game => [game.id, game]))
  return selected.map(entry => {
    const game = current.get(entry.game.id)
    if (game) return { game, missing: false }
    const date = manilaDate(new Date(entry.game.starts_at))
    return date >= from && date < to ? { ...entry, missing: true } : entry
  })
}

// A filtered page only refreshes records it actually contains. Only the explicit
// selected-ID lookup can establish that an off-page selection is unavailable.
export function mergeSelectedSnapshots(selected: SelectedGame[], games: ClubGame[], missingIds: string[] = []): SelectedGame[] {
  const current = new Map(games.map(game => [game.id, game]))
  const missing = new Set(missingIds)
  return selected.map(entry => {
    const game = current.get(entry.game.id)
    return game ? { game, missing: false } : missing.has(entry.game.id) ? { ...entry, missing: true } : entry
  })
}
