import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Registration } from '@/features/club/ui/registration/registration'
import { POSITIONS, type ClubGame, type ClubSession } from '@/features/club/model/types'

const game: ClubGame = {
  id: '11111111-1111-4111-8111-111111111111', venue: 'Fixture Court', city: 'Makati',
  starts_at: '2026-11-04T10:30:00Z', ends_at: '2026-11-04T13:30:00Z',
  status: 'published', team_price: 165000,
  positions: POSITIONS.map(position => ({ position, capacity: 6, available: 6, price: 30000 })),
}
const session: ClubSession = { configured: true, user: null, role: 'player', developer: false }
function render(value = game) {
  return renderToStaticMarkup(<Registration game={value} session={session} close={() => undefined} done={() => undefined} />)
}

describe('registration controls', () => {
  it('groups both native radios for keyboard navigation', () => {
    expect(render().match(/name="registration-kind"/g)).toHaveLength(2)
  })
  it('preserves the accessible registration group name', () => {
    expect(render()).toContain('<legend class="club-sr-only">Registration</legend>')
  })
  it('keeps team registration unavailable when one required position is short', () => {
    const html = render({ ...game, positions: game.positions.map(p => p.position === 'middle' ? { ...p, available: 1 } : p) })
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="team"/)
  })
  it('keeps the full game time in the booking summary', () => {
    expect(render()).toContain('6:30 PM–9:30 PM')
  })
})
