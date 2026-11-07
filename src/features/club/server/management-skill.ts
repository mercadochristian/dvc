import 'server-only'
import type { ManagementSkillProfile } from '../model/management-users'
import { isAdministrator } from '../model/permissions'
import { LEVEL_LABEL, type StaffRole } from '../model/types'
import { ClubError, record, uuid } from '../model/validation'
import { ORG, rpc } from './gateway'

export function saveManagementSkill(value: unknown, role: StaffRole, actor: string | null, reference: string) {
  if (!actor || !isAdministrator(role)) throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
  const { user_id, level, expected_version } = record(value)
  if (typeof level !== 'string' || !Object.hasOwn(LEVEL_LABEL, level)) throw new ClubError('Choose a skill level')
  if (typeof expected_version !== 'string' || !/^\d{1,10}$/.test(expected_version)) throw new ClubError('Invalid profile version')

  return rpc<ManagementSkillProfile>('dvc_management_skill_save', {
    p_org: ORG, p_actor: actor, p_target: uuid(user_id), p_level: level,
    p_version: expected_version, p_ref: reference,
  })
}
