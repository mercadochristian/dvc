import { checkoutCapacityWarning, checkoutDraftFrom, validTeamComposition, type CheckoutForm, type CheckoutGameForm } from './checkout-form'
import { checkoutPlayerErrors, type PlayerField } from './checkout-fields'
import { normalizeEmail, text } from './validation'

export type CheckoutStep = { kind: 'contact' } | { kind: 'game'; gameId: string }
export interface CheckoutStepIssue { message: string; playerIndex?: number; field?: PlayerField }
const validationRequestId = '00000000-0000-4000-8000-000000000000'

/** Navigation is presentation state only; it never modifies the reservation draft. */
export function checkoutStepIndex(form: CheckoutForm, step: CheckoutStep): number {
  return step.kind === 'contact' ? -1 : form.games.findIndex(entry => entry.game.id === step.gameId)
}
export function contactIssue(form: CheckoutForm): string | null {
  try {
    text(form.organizer.name, 'organizer name', 1, 100)
    normalizeEmail(text(form.organizer.contact, 'email', 3, 160))
    return null
  } catch (error) { return error instanceof Error ? error.message : 'Check your contact details.' }
}

/** Validate collapsed players too, using the same normalization as final review. */
export function checkoutGameIssue(form: CheckoutForm, entry: CheckoutGameForm): CheckoutStepIssue | null {
  // Player navigation happens before contact collection. This probe is used
  // only for local validation; the real draft still requires actual contact.
  const organizer = { name: form.organizer.name || 'Organizer', contact: 'Validation only', email: 'validation@example.invalid' }
  for (let index = 0; index < entry.players.length; index++) {
    const player = entry.players[index]
    const errors = checkoutPlayerErrors(player, form.organizer.name)
    const field = Object.keys(errors)[0] as PlayerField | undefined
    if (field) return { playerIndex: index, field, message: `Player ${index + 1}: ${errors[field]}` }
    try {
      checkoutDraftFrom({ organizer, games: [{ ...entry, organizer_plays: player.is_registrant, players: [player] }] }, validationRequestId)
    } catch (error) {
      return { playerIndex: index, message: `Player ${index + 1}: ${error instanceof Error ? error.message : 'Check player details.'}` }
    }
  }
  if (!validTeamComposition(entry)) return { message: 'Complete the minimum team positions before continuing.' }
  const capacity = checkoutCapacityWarning(entry)
  if (capacity) return { message: capacity }
  try { checkoutDraftFrom({ organizer, games: [entry] }, validationRequestId) }
  catch (error) { return { message: error instanceof Error ? error.message : 'Check this game.' } }
  return null
}
