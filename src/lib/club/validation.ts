import { ageOnDate } from './player-profile'
import { googleMapsUrl } from './maps'
import { LEVEL_LABEL, GENDER_LABEL, POSITIONS, type PlayerProfile } from './types'

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
export function assetPath(value: unknown, kind: 'payments' | 'receipts', owner?: string): string {
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
  if (required && (!level || !gender || (age === null && birthDate === null))) throw new ClubError('Choose level, gender, and age or birthday')
  return { level: level as PlayerProfile['level'], gender: gender as PlayerProfile['gender'], age: age as number | null, birth_date: birthDate as string | null }
}
export function validateHold(value: unknown) {
  const d = record(value)
  if (d.kind !== 'individual' && d.kind !== 'team') throw new ClubError('Choose individual or team')
  if (!POSITIONS.includes(d.position as typeof POSITIONS[number])) throw new ClubError('Choose a position')
  const teammates = d.teammates === undefined ? [] : d.teammates
  if (!Array.isArray(teammates) || teammates.length > 5) throw new ClubError('Add up to five teammates')
  if (d.kind === 'individual' && teammates.length) throw new ClubError('Teammates require team registration')
  const checked = teammates.map(value => {
    const player = record(value)
    if (!POSITIONS.includes(player.position as typeof POSITIONS[number])) throw new ClubError('Choose a teammate position')
    return { name: text(player.name, 'teammate name', 1, 100), position: player.position, ...validatePlayerProfile(player) }
  })
  for (const position of POSITIONS) {
    const maximum = (position === 'open' || position === 'middle' ? 2 : 1) - (d.position === position ? 1 : 0)
    if (checked.filter(player => player.position === position).length > maximum) throw new ClubError('Too many teammates in that position')
  }
  return { ...validatePlayerProfile(d), game_id: uuid(d.game_id), kind: d.kind, position: d.position, ...(d.teammates !== undefined ? { teammates: checked } : {}),
    name: text(d.name, 'name', 1, 100), contact: text(d.contact, 'email or phone', 3, 160) }
}
export function validateAction(action: string, value: unknown): Record<string, unknown> {
  const d = record(value)
  switch (action) {
    case 'manual.register': return validateHold(d)
    case 'game.save': {
      const start = text(d.starts_at, 'start', 10, 40), end = text(d.ends_at, 'end', 10, 40)
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) throw new ClubError('End must be after start')
      if (!['draft', 'published', 'completed'].includes(String(d.status))) throw new ClubError('Choose game status')
      const teamCount = d.team_count === undefined ? 4 : integer(d.team_count, 'teams', 20)
      if (!teamCount) throw new ClubError('Choose at least one team')
      const positions = record(d.positions), checked: Record<string, unknown> = {}
      for (const p of POSITIONS) {
        const entry = record(positions[p]); if (integer(entry.capacity, 'capacity', 120) > teamCount * (p === 'open' || p === 'middle' ? 2 : 1)) throw new ClubError('Capacity exceeds lineup team slots'); checked[p] = { capacity: integer(entry.capacity, 'capacity', 120), price: integer(entry.price, 'price', 100000000) }
      }
      return { ...(d.id ? { id: uuid(d.id) } : {}), venue_id: uuid(d.venue_id), team_count: teamCount,
        starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), status: d.status,
        team_price: integer(d.team_price, 'team price', 100000000), positions: checked, confirm_change: d.confirm_change === true }
    }
    case 'game.cancel': case 'booking.cancel': case 'receipt.approve': return { id: uuid(d.id) }
    case 'receipt.reject': return { id: uuid(d.id), note: text(d.note, 'rejection reason', 3, 300) }
    case 'booking.transfer': return { id: uuid(d.id), game_id: uuid(d.game_id) }
    case 'roster.update': return { ...(d.profile !== undefined ? { profile: validatePlayerProfile(d.profile, false) } : {}), expected_version: integer(d.expected_version, 'lineup version', 2147483647), ...(d.expected_team !== undefined ? { expected_team: d.expected_team === null ? null : integer(d.expected_team, 'previous team', 20) } : {}), id: uuid(d.id), name: typeof d.name === 'string' && !d.name.trim() ? '' : text(d.name, 'player name', 1, 100), team: d.team === null || d.team === '' ? null : integer(d.team, 'team', 20) || (() => { throw new ClubError('Teams start at 1') })() }
    case 'access.save': {
      if (d.role !== 'developer' && d.role !== 'admin' && d.role !== 'coordinator' && d.role !== 'facilitator') throw new ClubError('Choose a staff role')
      return { ...(d.id ? { id: uuid(d.id) } : {}), email: normalizeEmail(d.email), role: d.role, enabled: boolean(d.enabled) }
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
export function requestUrl(request: Request): URL {
  const expected = new URL(request.url)
  // Next's internal request URL can use localhost while Host is 127.0.0.1.
  // Host is the browser's actual destination; never trust forwarded-host here.
  if (request.headers.get('host')) expected.host = request.headers.get('host')!
  return expected
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin'), expected = requestUrl(request)
  if (!origin || origin !== expected.origin) throw new ClubError('Refresh the page and try again', 403, 'ORIGIN_DENIED')
}
export async function limitedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) throw new ClubError('Request body is required')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new ClubError('Request is too large', 413, 'BODY_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
export function dateWindow(from: string | null, to: string | null) {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ClubError('Choose a date range')
  const start = new Date(`${from}T00:00:00+08:00`), end = new Date(`${to}T00:00:00+08:00`)
  const days = (end.getTime() - start.getTime()) / 86400000
  if (!Number.isFinite(days) || days <= 0 || days > 62) throw new ClubError('Choose a range up to 62 days')
  return { start: start.toISOString(), end: end.toISOString() }
}
export function imageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (bytes.length > 3 * 1024 * 1024 || bytes.length < 12) throw new ClubError('Use an image up to 3 MB')
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp'
  throw new ClubError('Use a PNG, JPEG, or WebP image')
}
