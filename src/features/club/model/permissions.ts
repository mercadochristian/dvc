import type { StaffRole } from './types'
import { ClubError } from './validation'
export function canAct(role: StaffRole, action: string): boolean {
  const actions = ['game.save','game.cancel','manual.register','payment.save','access.save','receipt.approve','receipt.reject','booking.cancel','booking.transfer','roster.update','faci.assign','faci.self','booking.details','venue.save','venue.delete','announcement.save']
  if (!actions.includes(action)) return false
  return role === 'developer' || role === 'admin' || (role === 'coordinator' && ['roster.update', 'faci.assign', 'faci.self', 'manual.register', 'booking.details', 'announcement.save'].includes(action)) || (role === 'facilitator' && action === 'faci.self')
}
export function requireStaff(role: StaffRole) {
  if (role === 'player') throw new ClubError('Staff access required', 403, 'ACCESS_DENIED')
}
export function requireAction(role: StaffRole, action: string) {
  if (!canAct(role, action)) throw new ClubError('Access denied', 403, 'ACCESS_DENIED')
}

export function isAdministrator(role: StaffRole) { return role === 'admin' || role === 'developer' }
export function managesLineups(role: StaffRole) { return isAdministrator(role) || role === 'coordinator' }
