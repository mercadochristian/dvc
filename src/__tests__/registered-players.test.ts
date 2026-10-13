import { describe, expect, it, vi } from 'vitest'
import {
  createTimedRequestCache,
  findRegistrationTab,
  parseRegisteredPlayers,
} from '@/lib/registered-players'

describe('parseRegisteredPlayers', () => {
  it('groups only first names under the four known positions', () => {
    const rows = [
      [],
      ['Timestamp', 'Email Address', ' First  Name ', 'Last Name', 'Position'],
      ['1', 'ana@example.com', 'Ana', 'Santos', 'Setter'],
      ['2', 'ben@example.com', 'Ben', 'Reyes', 'Open Spiker'],
      ['3', 'cara@example.com', 'Cara', 'Cruz', 'Setter'],
      ['4', 'dana@example.com', 'Dana', 'Lee', 'Other'],
    ]

    expect(parseRegisteredPlayers(rows)).toEqual([
      { position: 'Open Spiker', players: [{ firstName: 'Ben', count: 1 }] },
      { position: 'Opposite Spiker', players: [] },
      { position: 'Middle Blocker', players: [] },
      { position: 'Setter', players: [
        { firstName: 'Ana', count: 1 },
        { firstName: 'Cara', count: 1 },
      ] },
    ])
  })

  it('keeps a place for registered rows with a blank first name', () => {
    const rows = [[], ['First Name', 'Position'], ['', 'Middle Blocker']]

    expect(parseRegisteredPlayers(rows)[2].players).toEqual([
      { firstName: 'Name unavailable', count: 1 },
    ])
  })

  it('recognizes a First Name header with form instructions appended', () => {
    const headers = Array(13).fill('') as string[]
    headers[7] = 'First Name (provide accurate and complete details to properly identify the player)'
    headers[8] = 'Last Name (provide accurate and complete details)'
    headers[12] = 'Position'
    const player = Array(13).fill('') as string[]
    player[7] = 'Ana'
    player[8] = 'Santos'
    player[12] = 'Setter'

    expect(parseRegisteredPlayers([[], headers, player])[3].players).toEqual([
      { firstName: 'Ana', count: 1 },
    ])
  })

  it('merges rows with the same email and first name within one position', () => {
    const rows = [
      [],
      ['Email Address', 'First Name', 'Position'],
      ['ANA@EXAMPLE.COM ', 'Ana', 'Setter'],
      ['ana@example.com', ' ana ', 'Setter'],
    ]

    expect(parseRegisteredPlayers(rows)[3].players).toEqual([
      { firstName: 'Ana', count: 2 },
    ])
  })

  it('keeps different first names on one email as separate entries', () => {
    const rows = [
      [],
      ['Email Address', 'First Name', 'Position'],
      ['team@example.com', 'Ana', 'Setter'],
      ['team@example.com', 'Ben', 'Setter'],
    ]

    expect(parseRegisteredPlayers(rows)[3].players).toEqual([
      { firstName: 'Ana', count: 1 },
      { firstName: 'Ben', count: 1 },
    ])
  })

  it('keeps one first name on different emails as separate entries', () => {
    const rows = [
      [],
      ['Email Address', 'First Name', 'Position'],
      ['ana1@example.com', 'Ana', 'Setter'],
      ['ana2@example.com', 'Ana', 'Setter'],
    ]

    expect(parseRegisteredPlayers(rows)[3].players).toEqual([
      { firstName: 'Ana', count: 1 },
      { firstName: 'Ana', count: 1 },
    ])
  })

  it('does not merge rows without an email', () => {
    const rows = [
      [],
      ['Email Address', 'First Name', 'Position'],
      ['', 'Ana', 'Setter'],
      ['', 'Ana', 'Setter'],
    ]

    expect(parseRegisteredPlayers(rows)[3].players).toEqual([
      { firstName: 'Ana', count: 1 },
      { firstName: 'Ana', count: 1 },
    ])
  })

  it('rejects a tab without a first name column', () => {
    expect(() => parseRegisteredPlayers([[], ['Name', 'Position']])).toThrow(
      'First Name column not found',
    )
  })
})

describe('createTimedRequestCache', () => {
  it('shares one loader for concurrent requests and reuses its result until expiry', async () => {
    let now = 1000
    const cache = createTimedRequestCache<number>(60_000, () => now)
    const loader = vi.fn(async () => 42)

    const [first, second] = await Promise.all([
      cache.get('game', loader),
      cache.get('game', loader),
    ])
    expect([first, second]).toEqual([42, 42])
    expect(loader).toHaveBeenCalledTimes(1)

    now += 59_000
    expect(await cache.get('game', loader)).toBe(42)
    expect(loader).toHaveBeenCalledTimes(1)

    now += 1_001
    expect(await cache.get('game', loader)).toBe(42)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('retries after a failed load instead of caching the error', async () => {
    const cache = createTimedRequestCache<number>(60_000)
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValueOnce(7)

    await expect(cache.get('game', loader)).rejects.toThrow('quota')
    expect(await cache.get('game', loader)).toBe(7)
  })
})

describe('findRegistrationTab', () => {
  it('matches a game using its date, location and time', () => {
    const tabs = [
      'Game Schedule',
      '04-14-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)',
    ]

    expect(findRegistrationTab(tabs, 'April 14, 2026', 'San Carlos Seminary', '6:30PM-9:30PM'))
      .toBe(tabs[1])
  })

  it('does not return a tab for a different game', () => {
    const tabs = ['04-14-26 - San Carlos Seminary (Tue, 6:30PM-9:30PM)']

    expect(findRegistrationTab(tabs, 'April 15, 2026', 'San Carlos Seminary', '6:30PM-9:30PM'))
      .toBeNull()
  })
})
