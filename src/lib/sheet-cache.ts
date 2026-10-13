import { createHash } from 'node:crypto'
import { revalidateTag, unstable_cache } from 'next/cache'
import { makeGameKey } from './parse'

const ALL_SHEETS_TAG = 'dvc-sheets-v2'
const pending = new Map<string, { tags: string[]; request: Promise<unknown> }>()
const loading = new Map<string, { tags: string[]; request: Promise<unknown> }>()

export function scheduleCacheTag(spreadsheetId: string): string {
  return `dvc-schedule:${spreadsheetId}`
}

export function rosterCacheTag(
  spreadsheetId: string,
  game: { date: string; location: string; time: string },
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([spreadsheetId, makeGameKey(game.date, game.location, game.time)]))
    .digest('hex')
  return `dvc-roster:${digest}`
}

/** Vercel's persistent Data Cache holds values; memory only coalesces active reads. */
export function cachedSheetRead<T>(
  keys: string[],
  tags: string[],
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify(keys)
  const existing = pending.get(key)
  if (existing) return existing.request as Promise<T>

  const allTags = [ALL_SHEETS_TAG, ...tags]
  const loadOnce = (): Promise<T> => {
    const active = loading.get(key)
    if (active) return active.request as Promise<T>
    const task = Promise.resolve().then(load).finally(() => {
      if (loading.get(key)?.request === task) loading.delete(key)
    })
    loading.set(key, { tags: allTags, request: task })
    return task
  }
  const request = Promise.resolve().then(() => unstable_cache(loadOnce, keys, {
    tags: allTags, revalidate: ttlSeconds,
  })()).finally(() => {
    if (pending.get(key)?.request === request) pending.delete(key)
  })
  pending.set(key, { tags: allTags, request })
  return request
}

function expireTags(tags: string[]) {
  for (const tag of tags) revalidateTag(tag, { expire: 0 })
  for (const requests of [pending, loading]) {
    for (const [key, entry] of requests) {
      if (entry.tags.some(tag => tags.includes(tag))) requests.delete(key)
    }
  }
}

export function invalidateRegistrationCache(
  spreadsheetId: string,
  game: { date: string; location: string; time: string },
) {
  expireTags([scheduleCacheTag(spreadsheetId), rosterCacheTag(spreadsheetId, game)])
}

export function invalidateAllSheetCaches() {
  expireTags([ALL_SHEETS_TAG])
}
