import type { PlayerProfile, StaffRole } from './types'

export interface ManagementSkillProfile {
  user_id: string
  level: NonNullable<PlayerProfile['level']>
  version: string
}

export interface ManagementUser {
  email: string
  name: string
  role: StaffRole
  registered: boolean
  verified: boolean
  skill_profile?: ManagementSkillProfile | null
  access_id: string | null
  access_role: Exclude<StaffRole, 'player'> | null
  access_enabled: boolean | null
  version: string | null
}

export interface ManagementUsersPage {
  rows: ManagementUser[]
  next_cursor: string | null
}
