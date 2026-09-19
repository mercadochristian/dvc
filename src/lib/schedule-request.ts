export interface ScheduleRequest {
  signal: AbortSignal
  isCurrent: () => boolean
}

/**
 * Ensures that only the newest schedule request is allowed to update the UI.
 * Starting a request aborts the previous browser request as well.
 */
export function createScheduleRequestManager() {
  let controller: AbortController | null = null
  let sequence = 0

  return {
    start(): ScheduleRequest {
      controller?.abort()
      controller = new AbortController()
      const requestSequence = ++sequence

      return {
        signal: controller.signal,
        isCurrent: () => requestSequence === sequence,
      }
    },
    abort(): void {
      controller?.abort()
      controller = null
      sequence++
    },
  }
}
