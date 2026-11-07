import 'server-only'
import type { ClubGame, StaffRole, Workspace } from '../model/types'
import { requireStaff } from '../model/permissions'
import { ClubError, uuid } from '../model/validation'
import { ORG, rpc, seal, unseal } from './gateway'

function boundary(value: string | null, nextDay = false) {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new ClubError('Choose a valid game date')
  }
  const start = Date.parse(`${value}T00:00:00+08:00`)
  return new Date(start + (nextDay ? 86_400_000 : 0)).toISOString()
}

export async function readStaffGames(q: URLSearchParams, role: StaffRole, actor: string | null) {
  requireStaff(role)
  if (!actor) throw new ClubError('Staff access required', 403, 'ACCESS_DENIED')
  if (q.get('view') === 'staff-game-context') {
    const operation = q.get('operation')
    if (!operation || !['manual','roster','payments','registrations','edit','cancel','facilitators'].includes(operation)) {
      throw new ClubError('Invalid game action')
    }
    const workspace = await rpc<Workspace | null>('dvc_staff_game_context', {
      p_org: ORG, p_user: actor, p_game: uuid(q.get('id')), p_operation: operation,
    })
    if (!workspace) throw new ClubError('Game not found', 404, 'NOT_FOUND')
    return workspace
  }
  if (['query','venue','venueId','status','from','to','sort','after'].some(key => q.getAll(key).length > 1)) {
    throw new ClubError('Duplicate game filter')
  }
  const query = (q.get('query') ?? '').trim().toLowerCase()
  const venueId = q.get('venueId')
  if (venueId && q.has('venue')) throw new ClubError('Choose a single venue filter')
  const venue = venueId ? `id:${uuid(venueId).toLowerCase()}` : (q.get('venue') ?? '').trim().toLowerCase()
  if (!venueId && venue.startsWith('id:')) throw new ClubError('Invalid venue filter')
  const status = q.get('status') ?? 'upcoming'
  const sort = q.get('sort') ?? 'asc'
  const from = boundary(q.get('from')), to = boundary(q.get('to'), true)
  if (query.length > 120 || venue.length > 120 || /\u0000/.test(query + venue) ||
    !['', 'upcoming','published','draft','completed','cancelled'].includes(status) ||
    !['asc','desc'].includes(sort) || (from && to && from >= to)) throw new ClubError('Invalid game filters')
  const scope = JSON.stringify([ORG,actor,role,query,venue,status,from,to,sort])
  const token = q.get('after')
  const cursor = token && token.length < 2048 ? unseal<{ scope: string; anchor: string; id: string; time: string }>(token) : null
  if (token !== null && (!cursor || cursor.scope !== scope || !Number.isFinite(Date.parse(cursor.anchor)) || !Number.isFinite(Date.parse(cursor.time)))) {
    throw new ClubError('Invalid games cursor')
  }
  const anchor = cursor?.anchor ?? new Date().toISOString()
  const page = await rpc<ClubGame[]>('dvc_staff_games', {
    p_org: ORG, p_user: actor, p_query: query, p_venue: venue, p_status: status || null,
    p_from: from, p_to: to, p_anchor: anchor, p_desc: sort === 'desc',
    p_after_time: cursor?.time ?? null, p_after_id: cursor ? uuid(cursor.id) : null,
  })
  const rows = page.slice(0, 25)
  const last = rows.at(-1)
  return { rows, next_cursor: last && page.length > 25 ? seal({ scope, anchor, time: last.starts_at, id: last.id }) : null }
}
