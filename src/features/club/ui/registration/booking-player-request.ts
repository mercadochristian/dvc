import { RequestError } from '@/features/club/api/client'
import type { RosterEntry } from '@/features/club/model/types'

export class PlayerUpdateUnknown extends Error {
  constructor() { super('The save result could not be confirmed. Close and refresh your bookings before editing again.') }
}

/** Aborting delivery cannot prove the server did not apply the personal edit. */
export async function confirmedPlayerUpdate(
  request: (signal: AbortSignal) => Promise<unknown>,
  target: { booking_id: string; entry_id: string; expected_version: number },
  timeout = 20_000,
): Promise<RosterEntry> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new PlayerUpdateUnknown()) }, timeout)
  })
  try {
    const response = await Promise.race([request(controller.signal), deadline]) as { entry?: RosterEntry } | null
    const entry = response?.entry
    if (!entry || entry.id !== target.entry_id || entry.booking_id !== target.booking_id || entry.version !== target.expected_version + 1) throw new PlayerUpdateUnknown()
    return entry
  } catch (error) {
    if (error instanceof RequestError && error.status !== undefined && error.status >= 400 && error.status < 500) throw error
    throw new PlayerUpdateUnknown()
  } finally { clearTimeout(timer!) }
}
