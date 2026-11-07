import type { ClubGame, RosterEntry } from '@/features/club/model/types'

// A response belongs to the dialog intent that requested it. Other dialog
// navigation, dismissal and unmount invalidate both late success and failure.
export class RosterRequest {
  private generation = 0
  invalidate() { this.generation += 1 }

  async load(game: ClubGame, read: (game: ClubGame) => Promise<RosterEntry[]>, accept: (entries: RosterEntry[]) => void, reject: (error: unknown) => void) {
    const generation = ++this.generation
    try {
      const entries = await read(game)
      if (generation === this.generation) accept(entries)
    } catch (error) {
      if (generation === this.generation) reject(error)
    }
  }
}
