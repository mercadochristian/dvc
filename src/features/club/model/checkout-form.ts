import { TEAM_POSITIONS } from './lineup'
import { POSITIONS, type CheckoutDraft, type CheckoutQuote, type ClubGame, type ClubPosition, type ClubSession, type PlayerProfile, type RegistrationKind, type RegistrationProfile } from './types'
import { validateCheckoutDraft } from './validation'

export interface CheckoutPlayerForm {
  /** Local identity only: never sent to the registration API. */
  form_id?: string
  has_details: boolean
  position: ClubPosition
  name: string
  is_registrant: boolean
  level: PlayerProfile['level']
  gender: PlayerProfile['gender']
  birth_date: string
  first_timer: boolean | null
  email: string
}
export interface CheckoutGameForm {
  game: ClubGame
  kind: RegistrationKind
  organizer_plays: boolean
  players: CheckoutPlayerForm[]
  /** Editable local draft only; never included in review/hold payloads. */
  organizer_player_draft?: { player: CheckoutPlayerForm; placeholder_id: string }
}
export interface CheckoutForm {
  organizer: { name: string; contact: string; email: string }
  games: CheckoutGameForm[]
}

function blankPlayer(position: ClubPosition): CheckoutPlayerForm {
  return { form_id: crypto.randomUUID(), has_details: false, position, name: '', is_registrant: false, level: null, gender: null, birth_date: '', first_timer: null, email: '' }
}
function ownPlayer(position: ClubPosition, profile?: RegistrationProfile | null): CheckoutPlayerForm {
  return { ...blankPlayer(position), has_details: Boolean(profile?.name && profile.level && profile.gender && profile.birth_date && typeof profile.first_timer === 'boolean'), is_registrant: true, name: profile?.name || '', level: profile?.level || null, gender: profile?.gender || null, birth_date: profile?.birth_date || '', first_timer: profile?.first_timer ?? null }
}
export function initialCheckoutForm(games: ClubGame[], session: ClubSession, profile?: RegistrationProfile | null): CheckoutForm {
  return {
    organizer: { name: profile?.name || session.user?.name || '', contact: session.user?.email || '', email: session.user?.email || '' },
    games: games.map(game => {
      const position = (profile && game.positions.some(slot => slot.position === profile.position && slot.available > 0) ? profile.position : POSITIONS.find(position => game.positions.some(slot => slot.position === position && slot.available > 0))) || 'open'
      return { game, kind: 'individual', organizer_plays: true, players: [ownPlayer(position, profile)] }
    }),
  }
}

function hasPlayerDraft(player: CheckoutPlayerForm) { return player.is_registrant || player.has_details || Boolean(player.name.trim() || player.level || player.gender || player.birth_date || player.email || player.first_timer !== null) }
export function registrationKind(count: number): RegistrationKind { return count === 1 ? 'individual' : count < 6 ? 'group' : 'team' }
function withPlayers(entry: CheckoutGameForm, players: CheckoutPlayerForm[]): CheckoutGameForm { return { ...entry, kind: registrationKind(players.length), players } }
export function missingTeamPositions(entry: CheckoutGameForm): ClubPosition[] {
  const remaining = [...TEAM_POSITIONS]
  for (const player of entry.players) {
    const index = remaining.indexOf(player.position)
    if (index >= 0) remaining.splice(index, 1)
  }
  return remaining
}
export function additionalPlayerPosition(entry: CheckoutGameForm): ClubPosition | null {
  if (entry.game.status !== 'published' || Date.parse(entry.game.starts_at) <= Date.now()) return null
  if (entry.players.length >= 5 && !teamAvailable(entry.game)) return null
  const availability = playerPositionAvailability(entry, -1)
  return [...missingTeamPositions(entry), ...POSITIONS].find(position => availability[position] > 0) || null
}
export function addCheckoutPlayer(entry: CheckoutGameForm): CheckoutGameForm {
  const position = additionalPlayerPosition(entry)
  return position ? withPlayers(entry, [...entry.players, blankPlayer(position)]) : entry
}
export function changeOrganizerParticipation(entry: CheckoutGameForm, plays: boolean, profile?: RegistrationProfile | null): CheckoutGameForm {
  if (entry.organizer_plays === plays) return entry
  if (plays) {
    const cached = entry.organizer_player_draft
    const emptyAvailable = (player: CheckoutPlayerForm, index: number) => !hasPlayerDraft(player) && playerPositionAvailability(entry, index)[player.position] > 0
    const original = cached ? entry.players.findIndex((player, index) => player.form_id === cached.placeholder_id && emptyAvailable(player, index)) : -1
    const available = original >= 0 ? original : entry.players.findIndex(emptyAvailable)
    if (available >= 0) {
      const slot = entry.players[available]
      const restored = cached ? cached.player.position === slot.position && cached.player.form_id === slot.form_id ? cached.player : { ...cached.player, position: slot.position, form_id: slot.form_id } : { ...ownPlayer(slot.position, profile), form_id: slot.form_id }
      const players = entry.players.map((player, index) => index === available ? restored : player)
      return { ...entry, organizer_plays: true, organizer_player_draft: undefined, players }
    }
    const fallback = additionalPlayerPosition(entry)
    if (!fallback) return entry
    const position = cached && playerPositionAvailability(entry, -1)[cached.player.position] > 0 ? cached.player.position : fallback
    const formId = cached?.player.form_id && !entry.players.some(player => player.form_id === cached.player.form_id) ? cached.player.form_id : crypto.randomUUID()
    const restored = cached ? cached.player.position === position && cached.player.form_id === formId ? cached.player : { ...cached.player, position, form_id: formId } : ownPlayer(position, profile)
    return { ...withPlayers(entry, [...entry.players, restored]), organizer_plays: true, organizer_player_draft: undefined }
  }
  const own = entry.players.find(player => player.is_registrant)
  if (!own) return entry
  const placeholder = { ...blankPlayer(own.position), form_id: own.form_id || crypto.randomUUID() }
  return { ...entry, organizer_plays: false, organizer_player_draft: { player: own, placeholder_id: placeholder.form_id }, players: entry.players.map(player => player === own ? placeholder : player) }
}
export function changePlayerPosition(entry: CheckoutGameForm, index: number, position: ClubPosition): CheckoutGameForm {
  const players = entry.players.map((player, playerIndex) => playerIndex === index ? { ...player, position } : player)
  return { ...entry, players }
}
export function removeCheckoutPlayer(entry: CheckoutGameForm, index: number): CheckoutGameForm {
  const player = entry.players[index]
  if (!player || player.is_registrant || entry.players.length <= 1) return entry
  return withPlayers(entry, entry.players.filter((_, playerIndex) => playerIndex !== index))
}
export function validTeamComposition(entry: CheckoutGameForm): boolean {
  return entry.players.length < 6 || missingTeamPositions(entry).length === 0
}
export function playerPositionAvailability(entry: CheckoutGameForm, index: number): Record<ClubPosition, number> {
  return Object.fromEntries(POSITIONS.map(position => [position, Math.max(0, (entry.game.positions.find(slot => slot.position === position)?.available || 0) - entry.players.filter((player, playerIndex) => playerIndex !== index && player.position === position).length)])) as Record<ClubPosition, number>
}
export function teamAvailable(game: ClubGame): boolean {
  return (game.available_teams === undefined || game.available_teams > 0) && POSITIONS.every(position => (game.positions.find(slot => slot.position === position)?.available || 0) >= (position === 'open' || position === 'middle' ? 2 : 1))
}
export function checkoutCapacityWarning(entry: CheckoutGameForm, now = Date.now()): string | null {
  if (entry.game.status !== 'published' || Date.parse(entry.game.starts_at) <= now) return 'This game is no longer open for registration. Remove it or choose another game.'
  if (entry.players.length >= 6 && !teamAvailable(entry.game)) return 'A full team is no longer available. Remove players to register up to five, or choose another game.'
  const full = POSITIONS.find(position => entry.players.filter(player => player.position === position).length > (entry.game.positions.find(slot => slot.position === position)?.available || 0))
  return full ? 'One or more selected positions exceed the available slots. Change their positions, remove a player or choose another game.' : null
}
export function checkoutFormEstimate(entry: CheckoutGameForm): number {
  if (entry.players.length >= 6) return entry.game.team_discount_price ?? entry.game.team_price
  return entry.players.reduce((amount, player) => {
    const slot = entry.game.positions.find(slot => slot.position === player.position)
    return amount + (slot?.discount_price ?? slot?.price ?? 0)
  }, 0)
}

/** Build review input only. Capacity, prices and consent remain server-owned. */
export function checkoutDraftFrom(form: CheckoutForm, requestId: string): CheckoutDraft {
  return validateCheckoutDraft({
    request_id: requestId,
    organizer: form.organizer,
    games: form.games.map(entry => ({
      game_id: entry.game.id,
      kind: registrationKind(entry.players.length),
      organizer_plays: entry.organizer_plays,
      players: entry.players.map(player => {
        const name = (player.is_registrant ? form.organizer.name : player.name).trim()
        return {
          position: player.position, has_details: player.has_details, name: player.has_details ? name || null : null, is_registrant: player.is_registrant,
          ...(player.has_details ? { level: player.level, gender: player.gender, birth_date: player.birth_date || null, first_timer: player.first_timer, email: player.email || null } : {}),
        }
      }),
    })),
  })
}

/** Consent covers the exact server-reviewed positions, prices and schedule. */
export function quotedCheckoutDraft(current: CheckoutDraft, reviewed: { draft: CheckoutDraft; quote: CheckoutQuote }): CheckoutDraft {
  let draft: CheckoutDraft, snapshot: CheckoutDraft, quotedInput: CheckoutDraft
  try {
    draft = validateCheckoutDraft(current); snapshot = validateCheckoutDraft(reviewed.draft)
    quotedInput = validateCheckoutDraft({ ...snapshot, games: reviewed.quote.games })
  } catch { throw new Error('Review these games again before payment') }
  if (JSON.stringify(draft) !== JSON.stringify(snapshot) || JSON.stringify(quotedInput) !== JSON.stringify(snapshot)) throw new Error('Review these games again before payment')
  return validateCheckoutDraft({
    ...draft,
    games: draft.games.map((game, index) => ({ ...game, expected_amount: reviewed.quote.games[index].amount, expected_quote: reviewed.quote.games[index].quote })),
  }, true)
}
