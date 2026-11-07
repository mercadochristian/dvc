import 'server-only'
import type { StaffRole } from '../model/types'
import { requireAction, requireStaff } from '../model/permissions'
import { ClubError, uuid } from '../model/validation'
import { db, ORG, seal, unseal } from './gateway'

export async function readManagementOptions(view: string, role: StaffRole, actor: string | null, params: URLSearchParams) {
  const org = encodeURIComponent(ORG)
  const future = encodeURIComponent(new Date().toISOString())
  let path: string
  let pageSize = 50
  let search = ''
  let status = ''
  switch (view) {
    case 'staff-game-venues':
      requireStaff(role)
      if (!actor) throw new ClubError('Staff access required', 403, 'ACCESS_DENIED')
      path = `venues?organization_id=eq.${org}&select=id,name,city`
      break
    case 'management-venues':
      requireAction(role, 'venue.save')
      path = `venues?organization_id=eq.${org}&select=id,name,city,enabled,maps_url`
      break
    case 'management-methods':
      requireAction(role, 'payment.save')
      path = `payment_methods?organization_id=eq.${org}&select=id,label,account_name,account_number,qr_path,enabled`
      break
    case 'management-announcements': {
      requireAction(role, 'announcement.save')
      if (!actor) throw new ClubError('Staff access required', 403, 'ACCESS_DENIED')
      search = (params.get('query') ?? '').trim()
      status = params.get('status') ?? ''
      if (search.length > 120 || search.includes('\0') || !['', 'Scheduled', 'Published', 'Ended', 'Unpublished'].includes(status) ||
          ['query', 'status'].some(key => params.getAll(key).length > 1)) throw new ClubError('Invalid announcement filters')
      pageSize = 25
      const filters = new URLSearchParams({ organization_id: `eq.${ORG}`, select: 'id,title,body,enabled,updated_at,publish_at,ends_at' })
      if (search) {
        // Quote the literal regex for PostgREST's logical-filter grammar.
        const literal = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const quoted = JSON.stringify(literal)
        filters.set('or', `(title.imatch.${quoted},body.imatch.${quoted})`)
      }
      const now = new Date().toISOString()
      if (status) filters.set('enabled', status === 'Unpublished' ? 'eq.false' : 'eq.true')
      if (status === 'Scheduled') filters.set('publish_at', `gt.${now}`)
      if (status === 'Ended') filters.set('ends_at', `lte.${now}`)
      if (status === 'Published') filters.set('and', `(or(publish_at.is.null,and(publish_at.lte.${now},ends_at.gt.${now})))`)
      path = `club_announcements?${filters}`
      break
    }
    case 'management-destinations':
      requireAction(role, 'booking.transfer')
      path = `games?organization_id=eq.${org}&select=id,venue,starts_at,status,venue_record:venues(organization_id,maps_url)&status=eq.published&starts_at=gt.${future}`
      break
    default:
      throw new ClubError('Page not found', 404)
  }
  const token = params.get('after')
  const scope = JSON.stringify(view === 'management-announcements' ? [ORG, view, actor, search, status] : [ORG, view, actor])
  const cursor = token && token.length < 2048 ? unseal<{ scope: string; id: string }>(token) : null
  if (params.getAll('after').length > 1 || (token !== null && (!cursor || cursor.scope !== scope))) {
    throw new ClubError('Invalid options cursor')
  }
  const after = cursor ? `&id=gt.${uuid(cursor.id)}` : ''
  const page = await db<{ id: string; venue_record?: { organization_id: string; maps_url: string | null } | null }[]>(`${path}${after}&order=id&limit=${pageSize + 1}`)
  const rows = page.slice(0, pageSize).map(({ venue_record, ...row }) => view === 'management-destinations'
    ? { ...row, maps_url: venue_record?.organization_id === ORG ? venue_record.maps_url : null }
    : row)
  const last = rows.at(-1)
  return { rows, next_cursor: page.length > pageSize && last ? seal({ scope, id: last.id }) : null }
}
