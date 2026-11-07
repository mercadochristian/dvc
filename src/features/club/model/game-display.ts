import type { ClubGame } from './types'

export function gameDisplayState(game: ClubGame, now = Date.now(), missing = false) {
  const total = game.positions.reduce((sum, position) => sum + Math.max(0, position.available), 0)
  const start = Date.parse(game.starts_at), end = Date.parse(game.ends_at)
  const label = missing ? 'Unavailable' : game.status === 'draft' ? 'Draft' : game.status === 'cancelled' ? 'Cancelled' : game.status === 'completed' ? 'Completed' : game.status !== 'published' ? 'Unavailable' : !Number.isFinite(start) || !Number.isFinite(end) ? 'Unavailable' : end <= now ? 'Completed' : start <= now ? 'In progress' : total === 0 ? 'Full' : 'Upcoming'
  const registerable = label === 'Upcoming'
  return { label, total, registerable, showAvailability: label === 'Upcoming' || label === 'Full', button: registerable ? 'Register' : label }
}
