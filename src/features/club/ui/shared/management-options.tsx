'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import { read, RequestError } from '@/features/club/api/client'
import { Empty, ErrorNotice } from './primitives'

export function useOptions<T extends { id: string }>(view: string, active: boolean, revision: number, onAccessLost: () => void) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [next, setNext] = useState<string | null>(null)
  const [requested, setRequested] = useState<{ revision: number; cursor: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const loadedPages = useRef(0)
  const loadedRequest = useRef<string | null>(null)
  const after = requested?.revision === revision ? requested.cursor : null

  useEffect(() => {
    if (!active) return
    let current = true
    setLoading(true)
    setError(null)
    async function load() {
      const requestKey = after ? `${revision}:${after}` : null
      const append = requestKey !== null && loadedRequest.current !== requestKey
      let pageCursor = append ? after : null
      const pageCount = append ? 1 : Math.max(1, loadedPages.current)
      const found: T[] = []
      let pages = 0
      do {
        const result: { rows: T[]; next_cursor: string | null } = await read(view, pageCursor ? { after: pageCursor } : {})
        if (!current) return
        found.push(...result.rows)
        pageCursor = result.next_cursor
        pages += 1
      } while (pageCursor && pages < pageCount)
      loadedPages.current = append ? loadedPages.current + pages : pages
      loadedRequest.current = requestKey
      setRows(prior => append
        ? [...new Map([...(prior ?? []), ...found].map(row => [row.id, row])).values()]
        : found)
      setNext(pageCursor)
    }
    load().catch(error => {
      if (!current) return
      if (error instanceof RequestError && [401, 403].includes(error.status ?? 0)) {
        setRows(null)
        onAccessLost()
      }
      setError(error)
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [view, active, revision, onAccessLost, after, retry])
  function loadMore() {
    if (loading) return
    if (error) setRetry(value => value + 1)
    else if (next) setRequested({ revision, cursor: next })
  }
  return { rows, loading, error, hasMore: Boolean(next), loadMore }
}

export function MoreOptions({ options, noun = 'options', buttonRef }: {
  buttonRef?: Ref<HTMLButtonElement>
  noun?: string
  options: { loading: boolean; error: unknown; hasMore: boolean; loadMore: () => void }
}) {
  if (!options.hasMore && !options.error && !options.loading) return null
  return <button type="button" className="club-button quiet" ref={buttonRef} aria-disabled={options.loading} onClick={() => { if (!options.loading) options.loadMore() }}>
    {options.loading ? `Loading ${noun}…` : options.error ? `Retry ${noun}` : `Load more ${noun}`}
  </button>
}


export function OptionsState({ error, retry }: { error: unknown; retry: () => void }) {
  return error ? <><ErrorNotice error={error} /><button type="button" className="club-button" onClick={retry}>Retry</button></>
    : <Empty>Loading options…</Empty>
}
