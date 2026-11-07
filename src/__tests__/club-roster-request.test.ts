import { describe, expect, it, vi } from 'vitest'
import { RosterRequest } from '@/features/club/ui/games/roster-request'
import type { ClubGame, RosterEntry } from '@/features/club/model/types'

const game = { id: 'a' } as ClubGame
const rows: RosterEntry[] = [{ id: 'player-a', name: 'Player A', position: 'open', team: null }]
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

describe('roster dialog request ownership', () => {
  it('accepts the current game response', async () => {
    const request = new RosterRequest(), accept = vi.fn()
    await request.load(game, async value => value.id === 'a' ? rows : [], accept, vi.fn())
    expect(accept).toHaveBeenCalledWith(rows)
  })
  it('does not reopen game A players after another dialog invalidates its delayed request', async () => {
    const request = new RosterRequest(), response = deferred<RosterEntry[]>(), accept = vi.fn()
    const pending = request.load(game, () => response.promise, accept, vi.fn())
    request.invalidate()
    response.resolve(rows)
    await pending
    expect(accept).not.toHaveBeenCalled()
  })
  it('does not replace newer dialog errors with a stale rejection', async () => {
    const request = new RosterRequest(), response = deferred<RosterEntry[]>(), reject = vi.fn()
    const pending = request.load(game, () => response.promise, vi.fn(), reject)
    request.invalidate()
    response.reject(new Error('Late game A failure'))
    await pending
    expect(reject).not.toHaveBeenCalled()
  })
  it('keeps a newer roster when the previous request resolves last', async () => {
    const request = new RosterRequest(), old = deferred<RosterEntry[]>(), accept = vi.fn()
    const pending = request.load(game, () => old.promise, accept, vi.fn())
    const newRows: RosterEntry[] = [{ ...rows[0], id: 'player-b', name: 'Player B' }]
    await request.load({ ...game, id: 'b' }, async () => newRows, accept, vi.fn())
    old.resolve(rows)
    await pending
    expect(accept.mock.calls).toEqual([[newRows]])
  })
  it('reports an active request failure', async () => {
    const request = new RosterRequest(), reject = vi.fn(), error = new Error('Current request failed')
    await request.load(game, async () => { throw error }, vi.fn(), reject)
    expect(reject).toHaveBeenCalledWith(error)
  })
  it('can request another roster after dismissal', async () => {
    const request = new RosterRequest(), accept = vi.fn()
    request.invalidate()
    await request.load(game, async () => rows, accept, vi.fn())
    expect(accept).toHaveBeenCalledWith(rows)
  })
})
