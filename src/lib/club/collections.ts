import type { ClubGame, Booking, SupportRegistration } from './types'
export function matchesSearch(query: string, ...values: (string | null | undefined)[]) {
  return values.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}
export function selectGames(games: ClubGame[], query: string, status = '', order = 'soonest') {
  return games.filter(game => (!status || game.status === status) && matchesSearch(query, game.venue, game.city))
    .sort((a,b) => (Date.parse(a.starts_at)-Date.parse(b.starts_at))*(order === 'latest' ? -1 : 1))
}
export function paymentState(booking: Booking) {
  return booking.payment_status === 'approved' ? 'approved' : booking.payment_status === 'rejected' ? 'rejected' : booking.receipt ? 'review' : 'missing'
}
export const PAYMENT_LABEL: Record<string,string> = { approved: 'Approved', rejected: 'Rejected', review: 'Under review', missing: 'Awaiting receipt' }
export function selectRegistrations(rows: SupportRegistration[], games: ClubGame[], query: string, gameId = '', status = '') {
  const venues = new Map(games.map(game => [game.id, game.venue]))
  return rows.filter(row => (!gameId || row.game_id === gameId) && (!status || row.status === status) && matchesSearch(query,row.captain_name,row.contact,venues.get(row.game_id)))
}
