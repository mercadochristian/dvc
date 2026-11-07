import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { canSelectGame, refreshSelectedGames, toggleSelectedGame, type SelectedGame } from '@/features/club/model/games-selection'
import { GameSelectionControl, SelectedGames } from '@/features/club/ui/games/game-selection'
import { GameCard } from '@/features/club/ui/games/game-card'
import { GameTable } from '@/features/club/ui/games/game-table'
import type { ClubGame } from '@/features/club/model/types'

const noop = () => undefined
const now = Date.parse('2099-11-01T00:00:00Z')
const game: ClubGame = { id: 'one', venue: 'Court A', city: 'Makati', starts_at: '2099-11-04T10:00:00Z', ends_at: '2099-11-04T13:00:00Z', status: 'published', team_price: 165000, positions: [{ position: 'setter', capacity: 2, available: 1, price: 25000 }] }
const entry = (value = game): SelectedGame => ({ game: value, missing: false })

describe('game selection before registration', () => {
  it('keeps same-time games with different IDs independently selected', () => {
    const selected = toggleSelectedGame(toggleSelectedGame([], game, now), { ...game, id: 'two' }, now)
    expect(selected.map(value => value.game.id)).toEqual(['one', 'two'])
  })
  it('removes an existing ID rather than duplicating it', () => {
    expect(toggleSelectedGame([entry()], { ...game, venue: 'Changed court' }, now)).toEqual([])
  })
  it('does not mutate the original selection when another game is added', () => {
    const selected = [entry()]
    toggleSelectedGame(selected, { ...game, id: 'two' }, now)
    expect(selected).toEqual([entry()])
  })
  it.each(['draft', 'cancelled', 'completed'] as const)('does not select a %s game', status => {
    expect(toggleSelectedGame([], { ...game, status }, now)).toEqual([])
  })
  it('does not select a full game', () => expect(canSelectGame({ ...game, positions: [{ ...game.positions[0], available: 0 }] }, now)).toBe(false))
  it('does not select a game at its start instant', () => expect(canSelectGame(game, Date.parse(game.starts_at))).toBe(false))
  it('still allows removal after a selected game closes', () => {
    expect(toggleSelectedGame([entry()], { ...game, status: 'cancelled' }, now)).toEqual([])
  })
  it('retains selections from another fetched week', () => {
    expect(refreshSelectedGames([entry()], [], '2099-11-09', '2099-11-16')).toEqual([entry()])
  })
  it('refreshes the matching ID with current prices and availability', () => {
    const fresh = { ...game, team_price: 150000, positions: [{ ...game.positions[0], available: 0 }] }
    expect(refreshSelectedGames([entry()], [fresh], '2099-11-02', '2099-11-09')).toEqual([entry(fresh)])
  })
  it('marks missing games in the fetched week without dropping the selection', () => {
    expect(refreshSelectedGames([entry()], [], '2099-11-02', '2099-11-09')).toEqual([{ game, missing: true }])
  })
  it('uses Manila dates when reconciling a game near midnight UTC', () => {
    const nextDay = { ...game, starts_at: '2099-11-03T18:00:00Z' }
    expect(refreshSelectedGames([entry(nextDay)], [], '2099-11-04', '2099-11-05')[0].missing).toBe(true)
  })
  it('clears the missing warning if the same game returns', () => {
    expect(refreshSelectedGames([{ game, missing: true }], [game], '2099-11-02', '2099-11-09')[0].missing).toBe(false)
  })
  it('does not replace a missing game with a same-time different ID', () => {
    expect(refreshSelectedGames([entry()], [{ ...game, id: 'two' }], '2099-11-02', '2099-11-09')[0].game.id).toBe('one')
  })
})

describe('game selection controls', () => {
  it('exposes selected state with a game-specific accessible name', () => {
    expect(renderToStaticMarkup(<GameSelectionControl game={game} selected toggle={noop} />)).toMatch(/aria-pressed="true" aria-label="Selected: Court A,/)
  })
  it('disables selecting a full game', () => {
    expect(renderToStaticMarkup(<GameSelectionControl game={{ ...game, positions: [] }} selected={false} toggle={noop} />)).toContain('disabled=""')
  })
  it('keeps removal enabled after a selected game becomes full', () => {
    expect(renderToStaticMarkup(<GameSelectionControl game={{ ...game, positions: [] }} selected toggle={noop} />)).not.toContain('disabled=')
  })
  it('warns when a selected game disappears', () => {
    expect(renderToStaticMarkup(<SelectedGames selected={[{ game, missing: true }]} open={noop} remove={noop} />)).toContain('This game is no longer available')
  })
  it('warns when refreshed capacity is exhausted', () => {
    expect(renderToStaticMarkup(<SelectedGames selected={[entry({ ...game, positions: [] })]} open={noop} remove={noop} />)).toContain('This game is no longer available')
  })
  it('makes the lack of reservation explicit', () => {
    expect(renderToStaticMarkup(<SelectedGames selected={[entry()]} open={noop} remove={noop} />)).toContain('Selecting games does not reserve slots.')
  })
  it('does not invent a combined checkout total before choosing positions', () => {
    expect(renderToStaticMarkup(<SelectedGames selected={[entry()]} open={noop} remove={noop} />)).not.toContain('₱')
  })
  it('keeps an empty selection dialog recoverable', () => {
    expect(renderToStaticMarkup(<SelectedGames selected={[]} open={noop} remove={noop} />)).toContain('No games selected')
  })
  it('disables registration when a selected snapshot is no longer in the schedule', () => {
    expect(renderToStaticMarkup(<GameCard game={game} unavailable register={noop} players={noop} />)).toMatch(/<button[^>]*disabled=""[^>]*>Unavailable/)
  })
  it('renders a public details action when supplied by the Games controller', () => {
    expect(renderToStaticMarkup(<GameTable games={[game]} register={noop} players={noop} details={noop} />)).toContain('>Details</button>')
  })
})
