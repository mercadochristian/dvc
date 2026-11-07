'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { read, RequestError } from '@/features/club/api/client'
import { DEVELOPER_LOG_PAGE_SIZE, type DeveloperEvent, type DeveloperLogPage } from '@/features/club/model/types'
import { CollectionTable, RecordStatus } from '../shared/collection'
import { Empty, ErrorNotice, Modal, RefreshButton } from '../shared/primitives'

import { AppliedFilters } from '../shared/applied-filters'
import { CursorPagination } from '../shared/cursor-pagination'

function eventTime(value: string) {
  return new Date(value).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function DeveloperLog() {
  const [kind, setKind] = useState('')
  const [reference, setReference] = useState('')
  const [referenceError, setReferenceError] = useState(false)
  const [query, setQuery] = useState('')
  const [trail, setTrail] = useState<string[]>([])
  const [refresh, setRefresh] = useState(0)
  const [page, setPage] = useState<{ scope: string; value: DeveloperLogPage; number: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [selected, setSelected] = useState<DeveloperEvent | null>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  const before = trail.at(-1) ?? ''
  const pageNumber = trail.length + 1
  const scope = JSON.stringify([kind, query])
  const currentPage = page?.scope === scope ? page : null
  const events = currentPage?.value.events ?? []
  const nextCursor = currentPage?.value.next_cursor

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    read<DeveloperLogPage>('logs', {
      pagination: 'cursor',
      ...(kind ? { kind } : {}), ...(query ? { reference: query } : {}), ...(before ? { before } : {}),
    }).then(value => {
      if (!active) return
      if (retryButton.current && document.activeElement === retryButton.current) {
        refreshButton.current?.focus({ preventScroll: true })
      }
      setPage({ scope, value, number: pageNumber })
    })
      .catch(error => {
        if (!active) return
        if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
          setPage(null)
          setSelected(null)
        }
        setError(error)
      })
      .finally(() => { if (active) { setLoading(false); setRetrying(false) } })
    return () => { active = false }
  }, [kind, query, before, pageNumber, refresh, scope])

  function reload() { setRefresh(value => value + 1) }
  function retry() {
    if (loading || retrying) return
    setRetrying(true)
    reload()
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = reference.trim()
    if (next && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(next)) {
      event.stopPropagation()
      setReferenceError(true)
      const field = event.currentTarget.elements.namedItem('reference')
      if (field instanceof HTMLInputElement) field.focus()
      return
    }
    setReferenceError(false)
    if (next === query && !before) return
    setQuery(next)
    setTrail([])
  }

  return <>
    <div className="club-page-title">
      <h1>Developer log</h1>
      <RefreshButton buttonRef={refreshButton} disabled={loading} onClick={reload} />
    </div>
    <AppliedFilters closeOnSubmit filters={[
      ...(kind ? [{ key: 'kind', label: kind === 'activity' ? 'Activity' : 'Errors', remove: () => { setKind(''); setTrail([]) } }] : []),
      ...(query ? [{ key: 'reference', label: query, remove: () => { setReference(''); setReferenceError(false); setQuery(''); setTrail([]) } }] : []),
    ]}>
    <form className="club-filter-fields" role="search" aria-label="Filter developer events" onSubmit={search}>
      <label>Type
        <select value={kind} onChange={event => { setKind(event.target.value); setTrail([]) }}>
          <option value="">All events</option>
          <option value="activity">Activity</option>
          <option value="error">Errors</option>
        </select>
      </label>
      <label>Reference ID
        <input name="reference" type="search" placeholder="Paste reference ID" value={reference}
          aria-invalid={referenceError} aria-describedby={referenceError ? 'developer-log-reference-error' : undefined}
          onChange={event => { setReference(event.target.value); setReferenceError(false) }} />
      </label>
      {referenceError && <ErrorNotice id="developer-log-reference-error" message="Enter a complete reference ID." />}
      <button type="submit" className="club-button primary">Find event</button>
    </form>
    </AppliedFilters>
    <ErrorNotice error={error} />
    {(Boolean(error) || retrying) && <div className="club-actions">
      {currentPage && <p className="club-note">Showing the last loaded events.</p>}
      <button type="button" className="club-button club-async-action" ref={retryButton}
        aria-disabled={loading || retrying} onClick={retry}>{retrying ? 'Retrying events…' : 'Retry events'}</button>
    </div>}
    {loading && !currentPage && <Empty>Loading events…</Empty>}
    {currentPage && <>
      {loading && <p className="club-sr-only" role="status">Refreshing events…</p>}
      <CollectionTable label="Developer events" headings={['Time · Manila', 'Action', 'Type', 'Actor', 'Reference', 'Details']}
        count={events.length} empty={kind || query ? 'No events match these filters.' : 'No events on this page.'}
        footer={<CursorPagination label="Developer log pages" pageSize={DEVELOPER_LOG_PAGE_SIZE} rowCount={events.length}
          pageNumber={currentPage.number} loading={loading}
          previous={trail.length ? () => setTrail(value => value.slice(0, -1)) : undefined}
          next={!error && nextCursor ? () => setTrail(value => [...value, nextCursor]) : undefined} />}>
        {events.map(event => <tr key={event.id}>
          <td data-label="Time · Manila"><time dateTime={event.created_at}>{eventTime(event.created_at)}</time></td>
          <td data-label="Action"><strong>{event.action}</strong></td>
          <td data-label="Type"><RecordStatus value={event.kind} /></td>
          <td data-label="Actor"><span title={event.actor_id || undefined}>{event.actor_id ? `Account ${event.actor_id.slice(0, 8)}` : 'Guest / unauthenticated'}</span></td>
          <td data-label="Reference"><code className="club-reference">{event.reference_id}</code></td>
          <td data-label="Details"><button type="button" className="club-button"
            aria-label={`Details for ${event.action}, ${event.reference_id}`} onClick={() => setSelected(event)}>Details</button></td>
        </tr>)}
      </CollectionTable>
    </>}
    {selected && <Modal title="Event details" close={() => setSelected(null)}>
      <dl className="club-detail-list">
        <dt>Action</dt><dd>{selected.action}</dd>
        <dt>Time · Manila</dt><dd>{eventTime(selected.created_at)}</dd>
        <dt>Actor</dt><dd>{selected.actor_id || 'Guest / unauthenticated'}</dd>
        <dt>Entity</dt><dd>{selected.entity_id || '—'}</dd>
        <dt>Reference</dt><dd><code>{selected.reference_id}</code></dd>
        <dt>Details</dt><dd><pre>{JSON.stringify(selected.details, null, 2)}</pre></dd>
      </dl>
    </Modal>}
  </>
}
