import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { addCheckoutPlayer, changeOrganizerParticipation, initialCheckoutForm } from '@/features/club/model/checkout-form'
import { checkoutGameIssue, checkoutStepIndex, contactIssue } from '@/features/club/model/checkout-wizard'
import { POSITIONS, type ClubGame, type ClubSession } from '@/features/club/model/types'
import { CheckoutDetails } from '@/features/club/ui/registration/checkout-details'
import { CheckoutPlayer } from '@/features/club/ui/registration/checkout-player'

const game: ClubGame = { id: '11111111-1111-4111-8111-111111111111', venue: 'First Court', city: 'Makati', starts_at: '2026-11-05T10:00:00Z', ends_at: '2026-11-05T12:00:00Z', status: 'published', team_price: 165000, positions: POSITIONS.map(position => ({ position, available: 8, capacity: 8, price: 30000 })) }
const second = { ...game, id: '22222222-2222-4222-8222-222222222222', venue: 'Second Court' }
const session: ClubSession = { configured: true, user: null, role: 'player', developer: false }
const noop = () => undefined
function form() {
  const value = initialCheckoutForm([game, second], session)
  value.organizer = { name: 'Organizer', contact: '+639000000000', email: 'organizer@example.test' }
  return value
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T04:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('checkout wizard validation', () => {
  it('validates contact independently from unfinished game/player details', () => {
    const value = form(); value.games[0].players[0].has_details = true
    value.organizer.contact = 'player@example.test'
    expect(contactIssue(value)).toBeNull()
    value.organizer.contact = 'invalid'
    expect(contactIssue(value)).toMatch(/email/)
  })
  it('finds the first incomplete detailed player even when another editor is active', () => {
    const value = form(), entry = addCheckoutPlayer(addCheckoutPlayer(value.games[0]))
    entry.players[1] = { ...entry.players[1], has_details: true, name: 'Second player' }
    entry.players[2] = { ...entry.players[2], has_details: true, name: 'Third player' }
    expect(checkoutGameIssue(value, entry)).toMatchObject({ playerIndex: 1, message: expect.stringContaining('Player 2:') })
  })
  it('accepts position-only rows without validating retained hidden personal values', () => {
    const value = form(), entry = addCheckoutPlayer(value.games[0])
    entry.players[1] = { ...entry.players[1], has_details: false, name: 'Retained draft', birth_date: 'invalid', email: 'invalid' }
    const before = structuredClone(entry)
    expect(checkoutGameIssue(value, entry)).toBeNull()
    expect(entry).toEqual(before)
  })
  it('rejects an invalid optional teammate email after profile fields are complete', () => {
    const value = form(), entry = addCheckoutPlayer(value.games[0])
    entry.players[1] = { ...entry.players[1], has_details: true, name: 'Teammate', level: 'intermediate', gender: 'female', birth_date: '1990-01-02', first_timer: false, email: 'bad' }
    expect(checkoutGameIssue(value, entry)).toMatchObject({ playerIndex: 1, message: expect.stringContaining('email') })
  })
  it('rejects actual overcapacity after all opted-in details are valid', () => {
    const value = form(), entry = addCheckoutPlayer(value.games[0])
    entry.players[1].position = entry.players[0].position
    entry.game = { ...game, positions: game.positions.map(slot => ({ ...slot, available: 1 })) }
    expect(checkoutGameIssue(value, entry)?.message).toMatch(/exceed/)
  })
  it('keeps 6+ minimum composition and flat team behavior intact', () => {
    const value = form(); let entry = value.games[0]
    while (entry.players.length < 7) entry = addCheckoutPlayer(entry)
    expect(checkoutGameIssue(value, entry)).toBeNull()
    entry.players = entry.players.map(player => ({ ...player, position: 'open' }))
    expect(checkoutGameIssue(value, entry)?.message).toMatch(/minimum team/)
  })
  it('resolves step identity after an earlier game is removed, without touching saved drafts', () => {
    const value = form(), target = { kind: 'game' as const, gameId: second.id }
    value.games[1] = changeOrganizerParticipation(value.games[1], false)
    const saved = value.games[1]
    expect(checkoutStepIndex(value, target)).toBe(1)
    const remaining = { ...value, games: [saved] }
    expect(checkoutStepIndex(remaining, target)).toBe(0)
    expect(remaining.games[0]).toBe(saved)
    expect(saved.organizer_player_draft).toBeDefined()
  })
})

describe('checkout wizard rendered structure', () => {
  it('renders the contact step without mounting hidden required player inputs', () => {
    const value = form(); value.games[0].players[0].has_details = true
    const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} step={{ kind: 'contact' }} value={value} update={noop} signedIn={false} busy={false} submit={noop} />)
    expect(html).toContain('Your contact details')
    expect(html).toContain('Review registration')
    expect(html).not.toContain('data-checkout-game-id')
    expect(html).not.toContain('type="date"')
  })
  it('mounts only the current game and one of twelve detailed player editors', () => {
    const value = form(); let entry = value.games[0]
    while (entry.players.length < 12) entry = addCheckoutPlayer(entry)
    entry.players = entry.players.map(player => ({ ...player, has_details: true }))
    value.games[0] = entry
    const html = renderToStaticMarkup(<CheckoutDetails navigate={noop} value={value} step={{ kind: 'game', gameId: game.id }} activePlayer={{ [game.id]: entry.players[4].form_id || '' }} update={noop} signedIn busy={false} submit={noop} />)
    expect(html).toContain('First Court')
    expect(html).not.toContain('Second Court')
    expect(html.match(/type="date"/g)).toHaveLength(1)
    expect(html.match(/<summary>/g)).toHaveLength(12)
    expect(html).toContain('Next game')
    expect(html).toContain('Estimated total')
  })
  it('preserves default standalone owner editor but omits fields in controlled collapsed mode', () => {
    const value = form(), player = { ...value.games[0].players[0], has_details: true }
    const standalone = renderToStaticMarkup(<CheckoutPlayer player={player} index={0} kind="individual" organizerName="Organizer" game={game} update={noop} positionLocked />)
    const collapsed = renderToStaticMarkup(<CheckoutPlayer expanded={false} player={player} index={0} kind="individual" organizerName="Organizer" game={game} update={noop} />)
    expect(standalone).toContain('type="date"')
    expect(collapsed).not.toContain('<input')
    expect(collapsed).toContain('<summary>')
  })
})
