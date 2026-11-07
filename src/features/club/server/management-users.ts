import 'server-only'
import type { StaffRole } from '../model/types'
import { requireAction } from '../model/permissions'
import { ClubError } from '../model/validation'
import { ORG, rpc, seal, unseal } from './gateway'

import type { ManagementUser, ManagementUsersPage } from '../model/management-users'

export async function readManagementUsers(params: URLSearchParams, role: StaffRole, actor: string | null): Promise<ManagementUsersPage> {
  requireAction(role, 'access.save')
  const query = (params.get('query') ?? '').trim()
  const filter = params.get('role') ?? ''
  const size = params.get('limit') ?? '25'
  const cursor = params.get('cursor')
  const limit = Number(size)
  if (query.length > 120 || !['', 'player', 'facilitator', 'coordinator', 'admin', 'developer'].includes(filter)
    || !/^\d{1,2}$/.test(size) || limit < 1 || limit > 50
    || ['query', 'role', 'limit', 'cursor'].some(key => params.getAll(key).length > 1)) {
    throw new ClubError('Invalid Users filters')
  }
  const scope = JSON.stringify([ORG, actor, 'management-users', query, filter, limit])
  const after = cursor && cursor.length < 2048 ? unseal<{ scope: string; email: string }>(cursor) : null
  if (cursor !== null && (!after || after.scope !== scope || typeof after.email !== 'string' || !after.email)) {
    throw new ClubError('Invalid Users cursor')
  }
  const page = await rpc<ManagementUser[]>('dvc_management_users', {
    p_org: ORG, p_user: actor, p_query: query, p_role: filter, p_after: after?.email ?? null, p_limit: limit,
  })
  const rows = page.slice(0, limit)
  const last = rows.at(-1)
  return { rows, next_cursor: last && page.length > limit ? seal({ scope, email: last.email }) : null }
}
