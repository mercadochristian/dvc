import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GameCard } from '@/components/game-card'
import type { Game } from '@/lib/types'

const game: Game = {
  id: 'game-1',
  date: 'April 14, 2026',
  location: 'San Carlos Seminary',
  city: 'Makati',
  time: '6:30PM-9:30PM',
  cancelled: false,
  status: 'open',
  positions: [
    { name: 'Open Spiker', needed: 2, filled: 1, available: 1 },
    { name: 'Opposite Spiker', needed: 1, filled: 0, available: 1 },
    { name: 'Middle Blocker', needed: 2, filled: 0, available: 2 },
    { name: 'Setter', needed: 1, filled: 1, available: 0 },
  ],
}

describe('GameCard registered players action', () => {
  it('offers the roster action without embedding player names in the card', () => {
    const html = renderToStaticMarkup(
      <GameCard game={game} weekId="week-1" messengerUrl="#" instagramUrl="#" />,
    )

    expect(html).toContain('View Registered Players')
    expect(html).not.toContain('Ana')
  })
})
