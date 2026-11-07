import { playerProfileFrom } from './player-profile'
import { POSITIONS, type ClubGame, type ClubPosition, type RosterEntry } from './types'
export const TEAM_POSITIONS: ClubPosition[] = ['open', 'open', 'opposite', 'middle', 'middle', 'setter']
export function teammateSlots(position: ClubPosition | null) {
  let removed = false
  return TEAM_POSITIONS.filter(value => { if (value === position && !removed) { removed = true; return false } return true })
    .map((value, index) => ({ position: value, key: `teammate-${value}-${index}` }))
}
export function teammatesFrom(form: FormData, position: ClubPosition | null) {
  return teammateSlots(position).map(slot => ({ position: slot.position, name: String(form.get(slot.key) || '').trim(), email: String(form.get(`${slot.key}-email`) || '').trim() || null, ...playerProfileFrom(form, `${slot.key}-`) })).filter(player => player.name)
}
export function lineupTeamCount(game: ClubGame) {
  return game.team_count || Math.min(20, Math.max(1, ...POSITIONS.map(position => Math.ceil((game.positions.find(p => p.position === position)?.capacity || 0) / (position === 'open' || position === 'middle' ? 2 : 1)))))
}
export function isUnassignedTeamExtra(entries: RosterEntry[], player: RosterEntry) {
  return player.kind === 'team' && player.team === null && Boolean(player.booking_id)
    && entries.filter(entry => entry.booking_id === player.booking_id).length > TEAM_POSITIONS.length
}

export function canPlace(entries: RosterEntry[], player: RosterEntry, team: number | null) {
  if (isUnassignedTeamExtra(entries, player)) return false
  if (team === null) return player.kind !== 'team'
  const others = entries.filter(entry => entry.team === team && entry.id !== player.id)
  if (player.kind === 'team') return others.every(entry => entry.booking_id === player.booking_id)
  if (others.some(entry => entry.kind === 'team')) return false
  return others.filter(entry => entry.position === player.position).length < (player.position === 'open' || player.position === 'middle' ? 2 : 1)
}
