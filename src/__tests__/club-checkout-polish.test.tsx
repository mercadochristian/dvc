import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { checkoutContactErrors, checkoutPlayerErrors, checkoutPlayerStatus, shouldConfirmDraftDiscard } from '@/features/club/model/checkout-fields'
import { initialCheckoutForm } from '@/features/club/model/checkout-form'
import { checkoutGameIssue } from '@/features/club/model/checkout-wizard'
import { POSITIONS, type ClubGame } from '@/features/club/model/types'
import { CheckoutPlayer } from '@/features/club/ui/registration/checkout-player'
const game: ClubGame = { id: '11111111-1111-4111-8111-111111111111', venue: 'Court', city: 'Test', status: 'published', starts_at: '2026-11-05T10:00:00Z', ends_at: '2026-11-05T12:00:00Z', team_price: 150000, positions: POSITIONS.map(position => ({ position, available: 1, capacity: 1, price: 30000 })) }
const form = () => initialCheckoutForm([game], { configured: true, user: null, role: 'player', developer: false })
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T04:00:00Z')) })
afterEach(() => vi.useRealTimers())
describe('registration detail status and recovery', () => {
  it('distinguishes unchecked, incomplete and valid complete details', () => {
    const player = form().games[0].players[0]
    expect(checkoutPlayerStatus(player, 'Organizer')).toBe('Position only')
    player.has_details = true
    expect(checkoutPlayerStatus(player, 'Organizer')).toBe('Details incomplete')
    Object.assign(player, { level: 'intermediate', gender: 'female', birth_date: '1995-04-12', first_timer: false })
    expect(checkoutPlayerStatus(player, 'Organizer')).toBe('Details complete')
    player.birth_date = '2026-02-30'
    expect(checkoutPlayerStatus(player, 'Organizer')).toBe('Details incomplete')
  })
  it('ignores retained hidden invalid values until details are enabled', () => {
    const player = { ...form().games[0].players[0], email: 'invalid', birth_date: 'invalid' }
    expect(checkoutPlayerErrors(player, '')).toEqual({})
    expect(checkoutPlayerStatus(player, '')).toBe('Position only')
  })
  it('targets the specific first invalid field in a collapsed player', () => {
    const value = form(); value.organizer = { name: 'Organizer', contact: '09123456789', email: 'test@example.test' }; value.games[0].players[0].has_details = true
    expect(checkoutGameIssue(value, value.games[0])).toMatchObject({ playerIndex: 0, field: 'level' })
  })
  it('keeps status incomplete for invalid optional teammate email', () => {
    const player = { ...form().games[0].players[0], is_registrant: false, name: 'Teammate', has_details: true, level: 'intermediate' as const, gender: 'female' as const, birth_date: '1995-04-12', first_timer: false, email: 'bad' }
    expect(checkoutPlayerErrors(player, 'Organizer')).toEqual({ email: expect.stringContaining('email') })
  })
  it('associates persistent errors with concise control names', () => {
    const player = { ...form().games[0].players[0], has_details: true }
    const html = renderToStaticMarkup(<CheckoutPlayer player={player} index={0} organizerName="Organizer" kind="individual" game={game} update={() => {}} validationAttempted />)
    expect(html).toMatch(/data-player-field="level" aria-label="Skill level" aria-invalid="true" aria-describedby="[^"]+-level-error"/)
    expect(html).toContain('Choose a level.')
    expect(html).toContain('Details incomplete')
  })
  it('preserves positive-snapshot zero-adjusted options for position correction', () => {
    const player = form().games[0].players[0]
    const html = renderToStaticMarkup(<CheckoutPlayer player={player} index={0} organizerName="Organizer" kind="individual" game={game} update={() => {}} availability={{ open: 0, middle: 0, opposite: 1, setter: 1 }} />)
    expect(html).toMatch(/<option value="middle">Middle Blocker · 0 free · reassign<\/option>/)
  })
  it('returns actionable organizer field errors for the single contact channel', () => expect(checkoutContactErrors({ name: '', contact: 'a', email: 'a@b' })).toEqual({ name: expect.any(String), contact: expect.any(String) }))
})
describe('pre-hold discard boundary', () => {
  it.each(['details', 'review'])('protects edited %s but keeps untouched close immediate', stage => { expect(shouldConfirmDraftDiscard(true, stage)).toBe(true); expect(shouldConfirmDraftDiscard(false, stage)).toBe(false) })
  it.each(['payment', 'recovery', 'loading'])('never treats %s or uncertain held intent as a disposable draft', stage => expect(shouldConfirmDraftDiscard(true, stage)).toBe(false))
})
