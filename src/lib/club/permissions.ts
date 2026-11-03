import type { StaffRole } from './types'
import { ClubError } from './validation'
export function canAct(role: StaffRole, action: string): boolean {
  return role === 'developer' || role === 'admin' || (role === 'coordinator' && ['roster.update', 'faci.assign', 'faci.self', 'manual.register', 'booking.details'].includes(action)) || (role === 'facilitator' && action === 'faci.self')
}
export function requireStaff(role: StaffRole) {
  if (role === 'player') throw new ClubError('Staff access required', 403, 'ACCESS_DENIED')
}
export function requireAction(role: StaffRole, action: string) {
  if (!canAct(role, action)) throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
}

export function isAdministrator(role: StaffRole) { return role === 'admin' || role === 'developer' }
export function managesLineups(role: StaffRole) { return isAdministrator(role) || role === 'coordinator' }
