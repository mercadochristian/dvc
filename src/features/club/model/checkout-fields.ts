import type { CheckoutForm, CheckoutPlayerForm } from './checkout-form'
import { normalizeEmail, text, validatePlayerProfile } from './validation'

export type PlayerField = 'name' | 'level' | 'gender' | 'birth_date' | 'first_timer' | 'email'
export type ContactField = 'name' | 'contact'
export type PlayerErrors = Partial<Record<PlayerField, string>>
export type ContactErrors = Partial<Record<ContactField, string>>
function invalid(check: () => unknown) { try { check(); return false } catch { return true } }

/** Presentation uses the existing boundary validators; final review remains authoritative. */
export function checkoutPlayerErrors(player: CheckoutPlayerForm, organizerName: string): PlayerErrors {
  if (!player.has_details) return {}
  const errors: PlayerErrors = {}
  if (invalid(() => text(player.is_registrant ? organizerName : player.name, 'player name', 1, 100))) errors.name = 'Enter the player’s name.'
  if (!player.level || invalid(() => validatePlayerProfile({ level: player.level }, false))) errors.level = 'Choose a level.'
  if (!player.gender || invalid(() => validatePlayerProfile({ gender: player.gender }, false))) errors.gender = 'Choose a gender option.'
  if (!player.birth_date || invalid(() => validatePlayerProfile({ birth_date: player.birth_date }, false))) errors.birth_date = 'Enter a valid birthday.'
  if (typeof player.first_timer !== 'boolean') errors.first_timer = 'Choose First-timer or Returnee.'
  if (!player.is_registrant && player.email && invalid(() => normalizeEmail(player.email))) errors.email = 'Enter a valid email address or leave it blank.'
  return errors
}
export function checkoutContactErrors(organizer: CheckoutForm['organizer']): ContactErrors {
  const errors: ContactErrors = {}
  if (invalid(() => text(organizer.name, 'organizer name', 1, 100))) errors.name = 'Enter your name.'
  if (invalid(() => normalizeEmail(text(organizer.contact, 'email', 3, 160)))) errors.contact = 'Enter a valid email address.'
  return errors
}
export function checkoutPlayerStatus(player: CheckoutPlayerForm, organizerName: string) {
  return !player.has_details ? 'Position only' : Object.keys(checkoutPlayerErrors(player, organizerName)).length ? 'Details incomplete' : 'Details complete'
}
/** Dirty is set only by user changes, not profile initialization or navigation. */
export function shouldConfirmDraftDiscard(dirty: boolean, stage: string) { return dirty && (stage === 'details' || stage === 'review') }
