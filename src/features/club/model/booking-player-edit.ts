import type { CheckoutPlayerForm } from './checkout-form'
import type { Booking, RosterEntry } from './types'

/** Client guidance only; the database rechecks ownership and the current clock. */
export function playerEditBlock(booking: Booking, now: number): string | null {
  if (booking.game_status !== 'published') return 'This game is not open for player-detail changes. Refresh to check its status.'
  if (booking.status !== 'reserved' && booking.status !== 'holding') return 'Player details cannot be edited for this booking.'
  if (booking.status === 'holding' && (!Number.isFinite(Date.parse(booking.expires_at)) || Date.parse(booking.expires_at) <= now)) return 'This hold has expired.'
  const start = Date.parse(booking.starts_at || '')
  if (!Number.isFinite(start)) return 'Refresh this booking before editing player details.'
  if (now >= start - 60 * 60 * 1000) return 'Player details are locked from one hour before the game.'
  return null
}

export function editablePlayer(entry: RosterEntry): CheckoutPlayerForm {
  return {
    form_id: entry.id, position: entry.position, is_registrant: Boolean(entry.is_registrant),
    has_details: entry.has_details ?? Boolean(entry.name), name: entry.name || '',
    level: entry.level || null, gender: entry.gender || null, birth_date: entry.birth_date || '',
    first_timer: entry.first_timer ?? null, email: entry.email || '',
  }
}

export function playerEditPayload(booking: Booking, entry: RosterEntry, player: CheckoutPlayerForm) {
  if (!Number.isInteger(entry.version) || entry.version! < 0) throw new Error('Refresh this booking before editing player details.')
  return {
    booking_id: booking.id, entry_id: entry.id, expected_version: entry.version!, has_details: player.has_details,
    name: player.has_details ? (entry.is_registrant ? booking.captain_name : player.name).trim() : null,
    ...(player.has_details ? {
      level: player.level, gender: player.gender, birth_date: player.birth_date || null,
      first_timer: player.first_timer, email: player.email || null,
    } : {}),
  }
}
