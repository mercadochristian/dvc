import { createHash } from 'node:crypto'
import { ClubError, uuid } from './validation'
import { POSITIONS, type ClubGame } from './types'

export interface BrowseCursor { v: 1; scope: string; anchor: string; bucket: 0 | 1; starts_at: string; id: string }
export interface BrowseFilters { date: string | null; venue: string | null; completed: boolean; cancelled: boolean; query: string; position: string | null }
function stamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ClubError('Invalid games cursor')
  const day = value.slice(0, 10)
  if (day.startsWith('0000') || Number(value.slice(11,13)) > 23 || Number(value.slice(14,16)) > 59 || Number(value.slice(17,19)) > 59) throw new ClubError('Invalid games cursor')
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new ClubError('Invalid games cursor')
  return value
}
export function browseScope(filters: BrowseFilters): string { return createHash('sha256').update(JSON.stringify(filters)).digest('hex') }
export function parseBrowse(q: URLSearchParams, now = new Date()) {
  for (const key of ['date','venue','completed','cancelled','query','position','after']) if (q.getAll(key).length > 1) throw new ClubError('Duplicate games filter')
  const date = q.get('date') || null
  if (date && (date.startsWith('0000') || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date)) throw new ClubError('Choose a valid game date')
  const flag = (key: string) => { const value = q.get(key); if (value !== null && value !== '0' && value !== '1') throw new ClubError('Invalid history filter'); return value === '1' }
  const query = (q.get('query') || '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (query.length > 120) throw new ClubError('Search must be at most 120 characters')
  const position = q.get('position') || null
  if (position && !POSITIONS.includes(position as typeof POSITIONS[number])) throw new ClubError('Choose a valid position')
  const filters: BrowseFilters = { date, venue: q.get('venue') ? uuid(q.get('venue')).toLowerCase() : null, completed: flag('completed'), cancelled: flag('cancelled'), query, position }
  const scope = browseScope(filters)
  let cursor: BrowseCursor | null = null
  const encoded = q.get('after')
  if (encoded) {
    try {
      if (encoded.length > 1500 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error()
      const raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      if (!raw || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'anchor,bucket,id,scope,starts_at,v' || raw.v !== 1 || raw.scope !== scope || (raw.bucket !== 0 && raw.bucket !== 1)) throw new Error()
      cursor = { v: 1, scope, anchor: stamp(raw.anchor), bucket: raw.bucket, starts_at: stamp(raw.starts_at), id: uuid(raw.id).toLowerCase() }
      if (Date.parse(cursor.anchor) > now.getTime() + 30000) throw new Error()
    } catch { throw new ClubError('Invalid games cursor. Refresh the games list') }
  }
  return { filters, scope, anchor: cursor?.anchor || now.toISOString(), cursor }
}
export function encodeBrowseCursor(scope: string, anchor: string, key: { bucket: 0 | 1; starts_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ v: 1, scope, anchor, ...key })).toString('base64url')
}
export interface BrowseRpcPage { games: ClubGame[]; next_key: { bucket: 0 | 1; starts_at: string; id: string } | null }
export function selectedGameIds(q: URLSearchParams): string[] {
  if (q.getAll('ids').length !== 1) throw new ClubError('Choose game IDs')
  const ids = (q.get('ids') || '').split(',')
  if (!ids.length || ids.length > 100) throw new ClubError('Choose between 1 and 100 game IDs per request')
  return [...new Set(ids.map(id => uuid(id).toLowerCase()))]
}
