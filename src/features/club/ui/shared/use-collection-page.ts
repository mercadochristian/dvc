'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { read, RequestError } from '@/features/club/api/client'

interface CollectionPage<Row> { rows: Row[]; next_cursor: string | null }

interface CollectionRead<Row> {
  owner: string
  scope: string
  request: string
  displayedPageNumber: number
  page?: CollectionPage<Row>
  error?: unknown
}

export function useCollectionPage<Row>(
  view: string, pageSize: number, owner: string, query: string, refresh: number, onAccessLost?: () => void, activeView = true,
  pageNumber = 1,
) {
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<CollectionRead<Row> | null>(null)
  const inFlight = useRef(new Map<string, Promise<CollectionPage<Row>>>())
  const accessLost = useEffectEvent(() => onAccessLost?.())
  const request = JSON.stringify([view, pageSize, owner, query, refresh, retry])
  const filters = new URLSearchParams(query)
  filters.delete('after')
  const scope = filters.toString()

  useEffect(() => {
    if (!activeView) return
    let active = true
    let pending = inFlight.current.get(request)
    if (!pending) {
      pending = read<CollectionPage<Row>>(view, {
        ...Object.fromEntries(new URLSearchParams(query)), limit: String(pageSize),
      })
      const requests = inFlight.current
      requests.set(request, pending)
      void pending.then(() => requests.delete(request), () => requests.delete(request))
    }
    pending.then(
      page => {
        if (active) setState({ owner, scope, request, page, displayedPageNumber: pageNumber })
      },
      error => {
        if (!active) return
        const denied = error instanceof RequestError && (error.status === 403 || error.status === 401)
        setState(previous => {
          const retained = !denied && previous?.owner === owner && previous.scope === scope ? previous : null
          return {
            owner, scope, request, error,
            page: retained?.page,
            displayedPageNumber: retained?.displayedPageNumber ?? pageNumber,
          }
        })
        if (denied) accessLost()
      },
    )
    return () => { active = false }
  }, [activeView, owner, query, request, scope, pageNumber, view, pageSize])

  const loading = state?.request !== request
  const displayed = state?.owner === owner && state.scope === scope ? state : null
  return {
    page: displayed?.page, loading,
    displayedPageNumber: displayed?.displayedPageNumber ?? pageNumber,
    error: loading ? null : state?.error,
    retry: () => setRetry(value => value + 1),
  }
}

export function useCursorPaging() {
  const [trail, setTrail] = useState<string[]>([])
  return {
    after: trail.at(-1) || '',
    pageNumber: trail.length + 1,
    previous: trail.length ? () => setTrail(value => value.slice(0, -1)) : undefined,
    next: (cursor: string) => setTrail(value => [...value, cursor]),
    reset: () => setTrail([]),
  }
}
