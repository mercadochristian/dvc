import { POSITION_NAMES, type PositionName } from './types'
import { makeGameKey, parseRegistrationTabName } from './parse'

export interface RegisteredPlayerGroup {
  position: PositionName
  players: { firstName: string; count: number }[]
}

export interface RegisteredPlayersResponse {
  groups: RegisteredPlayerGroup[]
  fetchedAt: string
}

export function emptyRegisteredPlayerGroups(): RegisteredPlayerGroup[] {
  return POSITION_NAMES.map(position => ({ position, players: [] }))
}

export function parseRegisteredPlayers(rows: string[][]): RegisteredPlayerGroup[] {
  const groups = emptyRegisteredPlayerGroups()
  if (rows.length < 2) return groups

  const headers = rows[1].map(header => header.toLowerCase().replace(/\s+/g, ' ').trim())
  const firstNameCol = headers.findIndex(header =>
    /^(first name|firstname|given name)\b/.test(header),
  )
  const emailCol = headers.findIndex(header => /^(email address|email)\b/.test(header))
  const positionCol = headers.indexOf('position')
  if (firstNameCol < 0) throw new Error('First Name column not found')
  if (positionCol < 0) throw new Error('Position column not found')

  const indexes = new Map<PositionName, Map<string, number>>()
  for (const row of rows.slice(2)) {
    const group = groups.find(({ position }) => position === row[positionCol]?.trim())
    if (!group) continue

    const firstName = row[firstNameCol]?.trim() || 'Name unavailable'
    const email = emailCol >= 0 ? row[emailCol]?.trim().toLowerCase() : ''
    if (email && firstName !== 'Name unavailable') {
      let positionIndexes = indexes.get(group.position)
      if (!positionIndexes) {
        positionIndexes = new Map()
        indexes.set(group.position, positionIndexes)
      }
      const key = JSON.stringify([email, firstName.toLowerCase()])
      const existingIndex = positionIndexes.get(key)
      if (existingIndex !== undefined) {
        group.players[existingIndex].count++
        continue
      }
      positionIndexes.set(key, group.players.length)
    }
    group.players.push({ firstName, count: 1 })
  }
  return groups
}

export function findRegistrationTab(
  tabNames: string[],
  date: string,
  location: string,
  time: string,
): string | null {
  const wanted = makeGameKey(date, location, time)
  return tabNames.find(tabName => {
    const parsed = parseRegistrationTabName(tabName)
    return parsed && makeGameKey(parsed.date, parsed.location, parsed.time) === wanted
  }) ?? null
}

export function createTimedRequestCache<T>(ttlMs: number, now: () => number = Date.now) {
  const values = new Map<string, { value: T; expiresAt: number }>()
  const pending = new Map<string, Promise<T>>()
  let generation = 0

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const cached = values.get(key)
      if (cached && now() < cached.expiresAt) return Promise.resolve(cached.value)
      const existing = pending.get(key)
      if (existing) return existing

      const startedAtGeneration = generation
      const request = Promise.resolve().then(load).then(value => {
        if (startedAtGeneration === generation) {
          values.set(key, { value, expiresAt: now() + ttlMs })
        }
        return value
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key)
      })
      pending.set(key, request)
      return request
    },
    clear() {
      generation++
      values.clear()
      pending.clear()
    },
  }
}
