import { ageOnDate } from './player-profile'
import { googleMapsUrl } from './maps'
import { LEVEL_LABEL, GENDER_LABEL, POSITIONS, type PlayerProfile, type CheckoutDraft, type CheckoutGameInput, type CheckoutPlayerInput, type CheckoutPriceSnapshot, type ClubPosition } from './types'

export class ClubError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_REQUEST') { super(message) }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClubError('Invalid request')
  return value as Record<string, unknown>
}
export function text(value: unknown, label: string, min = 1, max = 120): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new ClubError(`Check ${label}`)
  return value.trim()
}
export function uuid(value: unknown): string {
  const result = text(value, 'ID', 36, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new ClubError('Invalid ID')
  return result
}
export function integer(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw new ClubError(`Check ${label}`)
  return value
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ClubError('Invalid enabled value')
  return value
}
export function normalizeEmail(value: unknown): string {
  const email = text(value, 'email', 3, 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ClubError('Check email')
  return email
}
const FACEBOOK_CONTACT_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'messenger.com', 'www.messenger.com', 'm.me'])

export function registrationContact(value: unknown): { contact: string; email: string | null } {
  const contact = text(value, 'email or Facebook/Messenger link', 3, 160)
  try {
    const email = normalizeEmail(contact)
    if (!/[:/]/.test(email)) return { contact: email, email }
  } catch { /* Try a profile or Messenger link next. */ }
  try {
    const url = new URL(contact.includes('://') ? contact : `https://${contact}`)
    if (url.protocol === 'https:' && FACEBOOK_CONTACT_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port && url.pathname !== '/' && url.href.length <= 160 && !url.href.includes('@')) return { contact: url.href, email: null }
  } catch { /* Invalid URL. */ }
  throw new ClubError('Enter an email or a Facebook/Messenger link.')
}

export function assetPath(value: unknown, kind: 'payments' | 'receipts' | 'checkout-receipts', owner?: string): string {
  const path = text(value, 'image path', 1, 250)
  const parts = path.split('/')
  if (parts.length !== 3 || parts[0] !== kind || !/^[a-f0-9-]{36}\.(png|jpg|webp)$/i.test(parts[2])) throw new ClubError('Invalid image path')
  uuid(parts[1]); uuid(parts[2].split('.')[0])
  if (owner && parts[1] !== owner) throw new ClubError('Invalid image owner')
  return path
}
export function validatePlayerProfile(value: unknown, required = true): PlayerProfile {
  const d = record(value), today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const level = d.level === undefined || d.level === '' ? null : d.level
  const gender = d.gender === undefined || d.gender === '' ? null : d.gender
  if (level !== null && (typeof level !== 'string' || !Object.hasOwn(LEVEL_LABEL, level))) throw new ClubError('Choose a level')
  if (gender !== null && (typeof gender !== 'string' || !Object.hasOwn(GENDER_LABEL, gender))) throw new ClubError('Choose a gender option')
  const age = d.age === undefined || d.age === '' ? null : d.age
  const birthDate = d.birth_date === undefined || d.birth_date === '' ? null : d.birth_date
  if (age !== null) integer(age, 'age', 120)
  if (birthDate !== null) {
    if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new ClubError('Check birthday')
    const parsed = new Date(`${birthDate}T00:00:00Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate || birthDate > today || ageOnDate(birthDate, today) > 120) throw new ClubError('Check birthday')
  }
  if (age !== null && birthDate !== null) throw new ClubError('Enter age or birthday, not both')
  const firstTimer = d.first_timer === undefined || d.first_timer === null || d.first_timer === '' ? null : d.first_timer
  if (firstTimer !== null && typeof firstTimer !== 'boolean') throw new ClubError('Choose first-timer or returnee')
  if (required && (!level || !gender || birthDate === null)) throw new ClubError('Choose level, gender, and birthday')
  if (required && firstTimer === null) throw new ClubError('Choose first-timer or returnee')
  return { level: level as PlayerProfile['level'], gender: gender as PlayerProfile['gender'], age: age as number | null, birth_date: birthDate as string | null, first_timer: firstTimer as boolean | null }
}
export function validateHold(value: unknown) {
  const d = record(value)
  if (d.kind !== 'individual' && d.kind !== 'team') throw new ClubError('Choose individual or team')
  const organizerPlays = d.organizer_plays === undefined ? true : boolean(d.organizer_plays)
  if (!organizerPlays && d.kind !== 'team') throw new ClubError('Only a team may have a non-playing organizer')
  if (organizerPlays && !POSITIONS.includes(d.position as typeof POSITIONS[number])) throw new ClubError('Choose a position')
  if (!organizerPlays && d.position !== undefined && d.position !== null && d.position !== '') throw new ClubError('A non-playing organizer has no position')
  const position = organizerPlays ? d.position as typeof POSITIONS[number] : null
  const teammates = d.teammates === undefined ? [] : d.teammates
  const maximumNames = organizerPlays ? 5 : 6
  if (!Array.isArray(teammates) || teammates.length > maximumNames) throw new ClubError(`Add up to ${maximumNames} teammates`)
  if (d.kind === 'individual' && teammates.length) throw new ClubError('Teammates require team registration')
  const checked = teammates.map(value => {
    const player = record(value)
    if (!POSITIONS.includes(player.position as typeof POSITIONS[number])) throw new ClubError('Choose a teammate position')
    return { name: text(player.name, 'teammate name', 1, 100), position: player.position, email: player.email === undefined || player.email === null || player.email === '' ? null : normalizeEmail(player.email), ...validatePlayerProfile(player) }
  })
  for (const slot of POSITIONS) {
    const maximum = (slot === 'open' || slot === 'middle' ? 2 : 1) - (position === slot ? 1 : 0)
    if (checked.filter(player => player.position === slot).length > maximum) throw new ClubError('Too many teammates in that position')
  }
  return { ...(organizerPlays ? validatePlayerProfile(d) : {}), game_id: uuid(d.game_id), kind: d.kind, position,
    organizer_plays: organizerPlays, ...(d.teammates !== undefined ? { teammates: checked } : {}),
    name: text(d.name, 'name', 1, 100), contact: text(d.contact, 'email or phone', 3, 160), organizer_email: d.organizer_email === undefined || d.organizer_email === null || d.organizer_email === '' ? null : normalizeEmail(d.organizer_email) }
}
function checkoutSnapshot(value: unknown, positions: ClubPosition[]): CheckoutPriceSnapshot {
  const d = record(value), prices = record(d.position_prices)
  if (Object.keys(prices).length !== new Set(positions).size || Object.keys(prices).some(position => !positions.includes(position as ClubPosition))) throw new ClubError('Review the selected position prices again')
  const checked: Partial<Record<ClubPosition, number>> = {}
  for (const position of positions) checked[position] = integer(prices[position], 'position price', 100000000)
  const start = text(d.starts_at, 'start', 10, 40), end = text(d.ends_at, 'end', 10, 40)
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
  if (!timestamp.test(start) || !timestamp.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) throw new ClubError('Review the game schedule again')
  const maps = d.maps_url === null ? null : text(d.maps_url, 'venue map', 1, 2048)
  if (maps !== null && !googleMapsUrl(maps)) throw new ClubError('Review the venue map again')
  return { venue: text(d.venue, 'venue'), city: text(d.city, 'city'), maps_url: maps, starts_at: start, ends_at: end, team_price: integer(d.team_price, 'team price', 100000000), position_prices: checked }
}
/** New reviews explicitly opt into complete participant details. Legacy transport parsing is
 * private to hold retries; SQL checks the owned request before strict new review.
 */
export function validateCheckoutDraft(value: unknown, requireConsent = false): CheckoutDraft {
  return checkoutDraft(value, requireConsent, false)
}
export function validateCheckoutHoldDraft(value: unknown): CheckoutDraft {
  return checkoutDraft(value, true, true)
}
function checkoutDraft(value: unknown, requireConsent: boolean, allowLegacyUnnamed: boolean): CheckoutDraft {
  const d = record(value), organizer = record(d.organizer)
  // Keep older canonical payloads stable when recovering an existing hold.
  const channel = organizer.email == null || organizer.email === ''
    ? registrationContact(organizer.contact)
    : { contact: text(organizer.contact, 'organizer contact', 3, 160), email: normalizeEmail(organizer.email) }
  const checkedOrganizer = { name: text(organizer.name, 'organizer name', 1, 100), ...channel }
  if (!Array.isArray(d.games) || !d.games.length) throw new ClubError('Select at least one game')
  const seen = new Set<string>()
  const games: CheckoutGameInput[] = d.games.map(value => {
    const game = record(value), gameId = uuid(game.game_id)
    if (seen.has(gameId.toLowerCase())) throw new ClubError('Select each game only once')
    seen.add(gameId.toLowerCase())
    if (game.kind !== 'individual' && game.kind !== 'group' && game.kind !== 'team') throw new ClubError('Choose individual, group, or team')
    if (typeof game.organizer_plays !== 'boolean') throw new ClubError('Choose organizer participation')
    const count = Array.isArray(game.players) ? game.players.length : 0
    if (game.kind === 'individual' && count !== 1) throw new ClubError('Individual registration needs one player')
    if (game.kind === 'group' && (count < 2 || count > 5)) throw new ClubError('Group registration needs 2–5 players')
    if (game.kind === 'team' && count < 6) throw new ClubError('Team registration needs at least six players')
    const players: CheckoutPlayerInput[] = (game.players as unknown[]).map(value => {
      const player = record(value)
      if (!POSITIONS.includes(player.position as ClubPosition)) throw new ClubError('Choose a player position')
      if (typeof player.is_registrant !== 'boolean') throw new ClubError('Choose the organizer player slot')
      const explicit = typeof player.has_details === 'boolean'
      if (!explicit && (!allowLegacyUnnamed || player.has_details !== undefined)) throw new ClubError('Choose whether to add player details')
      const name = player.name === null || player.name === undefined || player.name === '' ? null : text(player.name, 'player name', 1, 100)
      const email = player.email === undefined || player.email === null || player.email === '' ? null : normalizeEmail(player.email)
      if (explicit && !player.has_details) {
        if (name || email || ['level','gender','birth_date','first_timer','age'].some(key => player[key] !== undefined && player[key] !== null && player[key] !== '')) throw new ClubError('Clear player details or enable Add player details')
        return { position: player.position as ClubPosition, name: null, is_registrant: player.is_registrant, has_details: false, email: null }
      }
      if (!name) {
        if (explicit || game.kind === 'individual' || player.is_registrant) throw new ClubError('Enter the player name')
        if (email || ['level','gender','birth_date','first_timer','age'].some(key => player[key] !== undefined && player[key] !== null && player[key] !== '')) throw new ClubError('Name this player before adding their details')
        // Keep the exact old normalized shape: adding a flag here would change
        // an already-owned request fingerprint and break an uncertain retry.
        return { position: player.position as ClubPosition, name: null, is_registrant: false, email: null }
      }
      if (player.is_registrant && name !== checkedOrganizer.name) throw new ClubError('The organizer player must use the organizer name')
      return { position: player.position as ClubPosition, name, is_registrant: player.is_registrant, ...(explicit ? { has_details: true } : {}), email, ...validatePlayerProfile(player) }
    })
    if (players.filter(player => player.is_registrant).length !== (game.organizer_plays ? 1 : 0)) throw new ClubError('Choose exactly one organizer slot when playing')
    if (game.kind === 'team' && POSITIONS.some(position => players.filter(player => player.position === position).length < (position === 'open' || position === 'middle' ? 2 : 1))) throw new ClubError('A team needs at least 2 Open, 1 Opposite, 2 Middle, and 1 Setter')
    return { game_id: gameId.toLowerCase(), kind: game.kind, organizer_plays: game.organizer_plays, players, ...(requireConsent ? { expected_amount: integer(game.expected_amount, 'reviewed game total', 2147483647), expected_quote: checkoutSnapshot(game.expected_quote, players.map(player => player.position)) } : {}) }
  })
  return { request_id: uuid(d.request_id).toLowerCase(), organizer: checkedOrganizer, games }
}
function discount(value: unknown, price: number): number | null {
  if (value === undefined || value === null || value === '') return null
  const amount = integer(value, 'discounted price', price)
  return amount
}
/** A personal-details edit never changes the reserved position or booking. */
export function validateBookingPlayerUpdate(value: unknown) {
  const d = record(value), allowed = new Set(['booking_id','entry_id','expected_version','has_details','name','email','level','gender','birth_date','first_timer'])
  if (Object.keys(d).some(key => !allowed.has(key))) throw new ClubError('Only player details can be changed')
  if (typeof d.has_details !== 'boolean') throw new ClubError('Choose whether to add player details')
  const ids = { booking_id: uuid(d.booking_id), entry_id: uuid(d.entry_id), expected_version: integer(d.expected_version, 'player version', 2147483647), has_details: d.has_details }
  if (!d.has_details) {
    if (['name','email','level','gender','birth_date','first_timer'].some(key => d[key] !== undefined && d[key] !== null && d[key] !== '')) throw new ClubError('Clear player details or enable Add player details')
    return { ...ids, name: null, email: null }
  }
  return { ...ids, name: text(d.name, 'player name', 1, 100), email: d.email === undefined || d.email === null || d.email === '' ? null : normalizeEmail(d.email), ...validatePlayerProfile(d) }
}
function announcementInstant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new ClubError('Enter a valid publish and end time')
  }
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value.replace(/(T\d{2}:\d{2}:\d{2})Z$/, '$1.000Z')) {
    throw new ClubError('Enter a valid publish and end time')
  }
  return instant.toISOString()
}

export function validateAction(action: string, value: unknown): Record<string, unknown> {
  const d = record(value)
  switch (action) {
    case 'manual.register': {
      if (!Object.hasOwn(d, 'games')) return validateHold(d)
      const draft = validateCheckoutDraft(d, true)
      if (draft.games.length !== 1) throw new ClubError('Choose exactly one game for manual registration')
      return { ...draft }
    }
    case 'announcement.save': {
      const publishAt = announcementInstant(d.publish_at)
      const endsAt = announcementInstant(d.ends_at)
      if (endsAt <= publishAt) throw new ClubError('End time must be after publish time')
      return { ...(d.id ? { id: uuid(d.id) } : {}), title: text(d.title, 'announcement title', 1, 120),
        body: text(d.body, 'announcement text', 1, 1500), enabled: boolean(d.enabled), publish_at: publishAt, ends_at: endsAt }
    }
    case 'game.save': {
      const start = text(d.starts_at, 'start', 10, 40), end = text(d.ends_at, 'end', 10, 40)
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) throw new ClubError('End must be after start')
      if (!['draft', 'published', 'completed'].includes(String(d.status))) throw new ClubError('Choose game status')
      const teamCount = d.team_count === undefined ? 4 : integer(d.team_count, 'teams', 20)
      if (!teamCount) throw new ClubError('Choose at least one team')
      const positions = record(d.positions), checked: Record<string, unknown> = {}
      for (const p of POSITIONS) {
        const entry = record(positions[p]); if (integer(entry.capacity, 'capacity', 120) > teamCount * (p === 'open' || p === 'middle' ? 2 : 1)) throw new ClubError('Capacity exceeds lineup team slots'); const price = integer(entry.price, 'price', 100000000); checked[p] = { capacity: integer(entry.capacity, 'capacity', 120), price, discount_price: discount(entry.discount_price, price) }
      }
      const expectedStart = d.id && d.expected_start !== undefined ? text(d.expected_start, 'original start', 10, 40) : null
      if (expectedStart && !Number.isFinite(Date.parse(expectedStart))) throw new ClubError('Invalid original start time')
      const saveTime = (value: string) => expectedStart && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? value : new Date(value).toISOString()
      return { ...(d.id ? { id: uuid(d.id) } : {}), ...(expectedStart ? { expected_start: expectedStart } : {}), venue_id: uuid(d.venue_id), team_count: teamCount,
        starts_at: saveTime(start), ends_at: saveTime(end), status: d.status,
        team_price: integer(d.team_price, 'team price', 100000000), team_discount_price: discount(d.team_discount_price, integer(d.team_price, 'team price', 100000000)), positions: checked, confirm_change: d.confirm_change === true }
    }
    case 'game.cancel': case 'booking.cancel': case 'receipt.approve': return { id: uuid(d.id) }
    case 'receipt.reject': return { id: uuid(d.id), note: text(d.note, 'rejection reason', 3, 300) }
    case 'booking.transfer': return { id: uuid(d.id), game_id: uuid(d.game_id) }
    case 'roster.update': return { ...(d.profile !== undefined ? { profile: validatePlayerProfile(d.profile, false) } : {}), expected_version: integer(d.expected_version, 'lineup version', 2147483647), ...(d.expected_team !== undefined ? { expected_team: d.expected_team === null ? null : integer(d.expected_team, 'previous team', 20) } : {}), id: uuid(d.id), name: typeof d.name === 'string' && !d.name.trim() ? '' : text(d.name, 'player name', 1, 100), team: d.team === null || d.team === '' ? null : integer(d.team, 'team', 20) || (() => { throw new ClubError('Teams start at 1') })() }
    case 'access.save': {
      if (d.role !== 'developer' && d.role !== 'admin' && d.role !== 'coordinator' && d.role !== 'facilitator') throw new ClubError('Choose a staff role')
      const version = d.expected_version
      if (version !== undefined && version !== null && (typeof version !== 'string' || !/^\d{1,10}$/.test(version))) {
        throw new ClubError('Invalid access version')
      }
      return { ...(d.id ? { id: uuid(d.id) } : {}), email: normalizeEmail(d.email), role: d.role, enabled: boolean(d.enabled), ...(version !== undefined ? { expected_version: version } : {}) }
    }
    case 'booking.details': return { id: uuid(d.id), name: text(d.name, 'name', 1, 100), contact: text(d.contact, 'email or phone', 3, 160) }
    case 'venue.save': {
      let mapsUrl: string | null | undefined
      if (d.maps_url !== undefined) {
        if (d.maps_url !== null && typeof d.maps_url !== 'string') throw new ClubError('Use a Google Maps link')
        mapsUrl = googleMapsUrl(d.maps_url as string | null)
        if (d.maps_url && !mapsUrl) throw new ClubError('Use a valid HTTPS Google Maps link')
      }
      return { ...(mapsUrl !== undefined ? { maps_url: mapsUrl } : {}), ...(d.id ? { id: uuid(d.id) } : {}), name: text(d.name, 'venue'), city: text(d.city, 'city'), enabled: boolean(d.enabled) }
    }
    case 'venue.delete': return { id: uuid(d.id) }
    case 'faci.self':
      if (d.user_id !== undefined) throw new ClubError('Self-assignment cannot choose another person')
      return { game_id: uuid(d.game_id), enabled: boolean(d.enabled) }
    case 'faci.assign': return { game_id: uuid(d.game_id), user_id: uuid(d.user_id), enabled: boolean(d.enabled) }
    case 'payment.save': return { ...(d.id ? { id: uuid(d.id) } : {}), label: text(d.label, 'method', 1, 100), account_name: text(d.account_name, 'account name'), account_number: text(d.account_number, 'account number', 1, 100), qr_path: d.qr_path ? assetPath(d.qr_path, 'payments') : null, enabled: boolean(d.enabled) }
    default: throw new ClubError('Unknown action')
  }
}
export function dateWindow(from: string | null, to: string | null) {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ClubError('Choose a date range')
  const start = new Date(`${from}T00:00:00+08:00`), end = new Date(`${to}T00:00:00+08:00`)
  const days = (end.getTime() - start.getTime()) / 86400000
  if (!Number.isFinite(days) || days <= 0 || days > 62) throw new ClubError('Choose a range up to 62 days')
  return { start: start.toISOString(), end: end.toISOString() }
}
