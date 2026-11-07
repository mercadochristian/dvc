import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { gameDisplayState } from '@/features/club/model/game-display'
import { mergeSelectedSnapshots } from '@/features/club/model/games-selection'
import { GameCard } from '@/features/club/ui/games/game-card'
import type { ClubGame } from '@/features/club/model/types'
const now = Date.parse('2026-11-04T10:00:00Z')
const game: ClubGame = { id: 'g', venue: 'Court', city: 'Test', status: 'published', starts_at: '2026-11-04T11:00:00Z', ends_at: '2026-11-04T13:00:00Z', team_price: 150000, positions: [{ position: 'open', available: 2, capacity: 4, price: 25000 }] }
describe('shared game lifecycle', () => {
  it.each([
    ['Upcoming', game],
    ['Full', { ...game, positions: [] }],
    ['In progress', { ...game, starts_at: '2026-11-04T09:00:00Z' }],
    ['Completed', { ...game, starts_at: '2026-11-04T08:00:00Z', ends_at: '2026-11-04T10:00:00Z' }],
    ['Cancelled', { ...game, status: 'cancelled' }],
    ['Draft', { ...game, status: 'draft' }],
    ['Completed', { ...game, status: 'completed' }],
  ] satisfies [string, ClubGame][])('labels %s consistently', (label, value) => { expect(gameDisplayState(value, now).label).toBe(label); expect(gameDisplayState(value, now).registerable).toBe(label === 'Upcoming') })
  it('gives unavailable and cancellation precedence over time', () => {
    expect(gameDisplayState({ ...game, status: 'cancelled', ends_at: '2020-01-01T00:00:00Z' }, now).label).toBe('Cancelled')
    expect(gameDisplayState(game, now, true).label).toBe('Unavailable')
  })
  it('does not advertise bookable inventory after start', () => {
    const html = renderToStaticMarkup(<GameCard game={{ ...game, starts_at: '2026-11-04T09:00:00Z' }} now={now} register={() => {}} players={() => {}} />)
    expect(html).toContain('In progress'); expect(html).not.toContain('Registration closed'); expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('2 left')
  })
  it('shows details immediately inside the game dialog even after the game starts', () => {
    const html = renderToStaticMarkup(<GameCard game={{ ...game, starts_at: '2026-11-04T09:00:00Z' }} now={now} inDialog players={() => {}} />)
    expect(html).toContain('data-collapsed="false"')
    expect(html).toContain('>Players</button>')
    expect(html).not.toContain('Show game details')
  })
  it('does not infer missing from an unrelated filtered page', () => {
    const selected = [{ game, missing: false }]
    expect(mergeSelectedSnapshots(selected, [])).toEqual(selected)
    expect(mergeSelectedSnapshots(selected, [], [game.id])[0].missing).toBe(true)
    expect(mergeSelectedSnapshots([{ game, missing: true }], [game])[0].missing).toBe(false)
  })
})
