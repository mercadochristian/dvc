import { teammateSlots, teammatesFrom } from './lineup'
import { playerProfileFrom } from './player-profile'
import { normalizeEmail, validateHold } from './validation'
import type { ClubGame, ClubPosition } from './types'

export interface RegistrationDraft {
  data: ReturnType<typeof validateHold>
  amount: number
  players: { position: ClubPosition; name: string | null }[]
}

/** Local review only: no network request or slot hold is created here. */
export function registrationDraft(form: FormData, game: ClubGame, kind: 'individual' | 'team', position: ClubPosition, organizerPlays = true): RegistrationDraft {
  const plays = kind === 'individual' || organizerPlays
  const selectedPosition = plays ? position : null
  const data = validateHold({
    ...(plays ? playerProfileFrom(form) : {}), game_id: game.id, kind, position: selectedPosition,
    organizer_plays: plays, name: form.get('name'), contact: form.get('contact'),
    organizer_email: normalizeEmail(form.get('organizer_email')),
    ...(kind === 'team' ? { teammates: teammatesFrom(form, selectedPosition) } : {}),
  })
  const players: RegistrationDraft['players'] = plays ? [{ name: data.name, position }] : []
  const teammates = data.teammates || []
  if (kind === 'team') {
    const used = new Set<number>()
    for (const slot of teammateSlots(selectedPosition)) {
      const index = teammates.findIndex((player, index) => player.position === slot.position && !used.has(index))
      if (index >= 0) used.add(index)
      players.push({ position: slot.position, name: index >= 0 ? teammates[index].name : null })
    }
  }
  const slot = game.positions.find(slot => slot.position === position)
  const amount = kind === 'team' ? game.team_discount_price ?? game.team_price : slot?.discount_price ?? slot?.price ?? 0
  return { data, amount, players }
}

export function holdSecondsRemaining(expiresAt: string, now: number): number {
  const expiry = Date.parse(expiresAt)
  return Number.isFinite(expiry) ? Math.min(600, Math.max(0, Math.ceil((expiry - now) / 1000))) : 0
}
