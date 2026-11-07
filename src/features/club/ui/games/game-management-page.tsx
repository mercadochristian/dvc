'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { act, read, RequestError } from '@/features/club/api/client'
import { dateLabel, timeLabel } from '@/features/club/model/format'
import type { ClubGame, PublicGameVenue, StaffRole, Venue, Workspace } from '@/features/club/model/types'
import { isAdministrator } from '@/features/club/model/permissions'
import { CollectionTable, RecordStatus } from '../shared/collection'
import { AppliedFilters, type AppliedFilter } from '../shared/applied-filters'
import { CursorPagination } from '../shared/cursor-pagination'
import { Empty, ErrorNotice, Modal, RefreshButton, Toast } from '../shared/primitives'
import { MoreOptions, OptionsState, useOptions } from '../shared/management-options'
import { GameEditor } from './game-editor'
import { GAME_OPERATION_LABEL, GameActions, GameOperationModal, type GameOperation } from './game-management'

const INITIAL = { venueId: '', from: '', to: '', status: 'upcoming', sort: 'asc' }
type GamePage = { rows: ClubGame[]; next_cursor: string | null }
type Selection = { game: ClubGame; operation: GameOperation }

export function GameManagementPage({ userId, role, reconcileSession }: {
  userId: string; role: StaffRole; reconcileSession: () => void
}) {
  const [venues, setVenues] = useState<PublicGameVenue[]>([])
  const [venueCursor, setVenueCursor] = useState<string | null>(null)
  const [venueRequest, setVenueRequest] = useState<{ after?: string }>({})
  const [venueError, setVenueError] = useState<unknown>(null)
  const [loadingVenues, setLoadingVenues] = useState(true)
  const [draft, setDraft] = useState(INITIAL)
  const [filters, setFilters] = useState(INITIAL)
  const [trail, setTrail] = useState<string[]>([])
  const [page, setPage] = useState<{ value: GamePage; number: number; scope: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(0)
  const admin = isAdministrator(role)
  const onVenueAccessLost = useRef(() => {
    setCreating(false)
    reconcileSession()
  }).current
  const createVenues = useOptions<Venue>('management-venues', admin && creating, revision, onVenueAccessLost)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<unknown>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [operationError, setOperationError] = useState<unknown>(null)
  const [operationRetry, setOperationRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const contextRequest = useRef(0)
  const selectedIntent = useRef<Selection | null>(null)
  const operationTrigger = useRef<HTMLElement | null>(null)
  const after = trail.at(-1) || ''
  const pageNumber = trail.length + 1
  const scope = JSON.stringify(filters)

  function denied(error: unknown) {
    return error instanceof RequestError && (error.status === 401 || error.status === 403)
  }

  useEffect(() => {
    let current = true
    read<{ rows: PublicGameVenue[]; next_cursor: string | null }>('staff-game-venues', venueRequest.after ? { after: venueRequest.after } : {})
      .then(page => {
        if (!current) return
        setVenues(previous => [...new Map([...previous, ...page.rows].map(venue => [venue.id, venue])).values()]
          .sort((a, b) => a.name.localeCompare(b.name) || (a.city ?? '').localeCompare(b.city ?? '') || a.id.localeCompare(b.id)))
        setVenueCursor(page.next_cursor)
      })
      .catch(error => { if (current) setVenueError(error) })
      .finally(() => { if (current) setLoadingVenues(false) })
    return () => { current = false }
  }, [venueRequest])

  function loadVenues(after?: string) {
    setLoadingVenues(true)
    setVenueError(null)
    setVenueRequest({ after })
  }

  useEffect(() => {
    let current = true
    setLoading(true)
    setListError(null)
    read<GamePage>('staff-games', { ...filters, ...(after ? { after } : {}) })
      .then(value => { if (current) setPage({ value, number: pageNumber, scope }) })
      .catch(error => {
        if (!current) return
        if (denied(error)) { setPage(null); close(); reconcileSession() }
        setListError(error)
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [filters, after, pageNumber, revision, reconcileSession, scope])

  useEffect(() => {
    if (!selection) return
    let current = true
    setOperationError(null)
    const request = ++contextRequest.current
    read<Workspace>('staff-game-context', { id: selection.game.id, operation: selection.operation })
      .then(value => { if (current && request === contextRequest.current) setWorkspace(value) })
      .catch(error => {
        if (!current || request !== contextRequest.current) return
        if (denied(error)) { close(); setPage(null); reconcileSession(); setListError(error); return }
        if (error instanceof RequestError && error.status === 404) { close(); refresh(); setListError(error); return }
        setOperationError(error)
      })
    return () => { current = false }
  }, [selection, operationRetry, reconcileSession])

  async function reloadContext() {
    const intent = selectedIntent.current
    if (!intent) throw new Error('Choose a game again')
    const request = ++contextRequest.current
    let value: Workspace
    try {
      value = await read<Workspace>('staff-game-context', { id: intent.game.id, operation: intent.operation })
    } catch (error) {
      if (selectedIntent.current === intent && request === contextRequest.current && denied(error)) {
        close()
        setPage(null)
        reconcileSession()
      }
      throw error
    }
    if (selectedIntent.current === intent && request === contextRequest.current) setWorkspace(value)
    return value
  }

  function refresh() { setRevision(value => value + 1) }

  function operationSaved() {
    refresh()
    const intent = selectedIntent.current
    if (intent?.operation === 'payments') {
      void reloadContext().catch(error => {
        if (selectedIntent.current === intent) setOperationError(new Error('Saved. Close and reopen this action to refresh its details.'))
      })
    }
  }

  async function action(name: string, data: unknown, reportError = setOperationError) {
    if (pending.current) return false
    const intent = selectedIntent.current
    pending.current = true
    setBusy(true)
    setOperationError(null)
    try {
      await act(name, data)
    } catch (error) {
      if (denied(error)) reconcileSession()
      if (selectedIntent.current === intent) reportError(error)
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
    refresh()
    if (intent && selectedIntent.current === intent && name !== 'game.cancel' && name !== 'faci.assign') {
      try { await reloadContext() } catch (error) {
        if (selectedIntent.current === intent) setOperationError(new Error('Saved. Close and reopen this action to refresh its details.'))
      }
    }
    return true
  }

  function applyFilters(next: typeof INITIAL) {
    setLoading(true)
    setFilters({ ...next })
    setTrail([])
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    applyFilters(draft)
  }

  const pills: AppliedFilter[] = []
  function addPill(key: keyof typeof INITIAL, label: string, clear = '') {
    pills.push({ key, label, remove: () => {
      setDraft(current => ({ ...current, [key]: clear }))
      applyFilters({ ...filters, [key]: clear })
    } })
  }

  const venueLabel = (venue: PublicGameVenue) => venue.city ? `${venue.name} · ${venue.city}` : venue.name
  const selectedVenue = venues.find(venue => venue.id === filters.venueId)
  if (selectedVenue) addPill('venueId', venueLabel(selectedVenue))
  if (filters.from) addPill('from', `From: ${dateLabel(`${filters.from}T12:00:00+08:00`)}`)
  if (filters.to) addPill('to', `Through: ${dateLabel(`${filters.to}T12:00:00+08:00`)}`)
  if (filters.status) addPill('status', filters.status === 'upcoming' ? 'Upcoming and in progress' : `Status: ${filters.status}`)
  if (filters.sort === 'desc') addPill('sort', 'Latest first', 'asc')

  function close() {
    selectedIntent.current = null
    contextRequest.current += 1
    setSelection(null)
    setWorkspace(null)
    setOperationError(null)
    const opener = operationTrigger.current
    queueMicrotask(() => {
      const target = opener?.isConnected ? opener : document.getElementById('staff-games-heading')
      target?.focus({ preventScroll: true })
    })
  }

  const visiblePage = page?.scope === scope ? page : null
  const rows = visiblePage?.value.rows ?? []
  const next = visiblePage?.value.next_cursor
  const actionContext: Workspace = { role, games: [], roster: [] }
  return <section className="club-staff club-staff-games-page" aria-labelledby="staff-games-heading">
    <div className="club-page-title club-management-title">
      <h1 id="staff-games-heading" tabIndex={-1}>Game Management</h1>
      <div className="club-actions club-management-actions">
        {admin && <button type="button" className="club-button primary" onClick={() => setCreating(true)}>Create game</button>}
        <RefreshButton disabled={loading} onClick={refresh} />
      </div>
    </div>
    <p className="club-section-note">Dates and times are shown in Manila time.</p>
    {created > 0 && <Toast key={created} message="Game created" />}
    {admin && creating && <GameEditor venues={createVenues.rows ?? []}
      optionsState={!createVenues.rows ? <OptionsState error={createVenues.error} retry={createVenues.loadMore} /> : undefined}
      moreOptions={<><ErrorNotice error={createVenues.error} /><MoreOptions options={createVenues} /></>}
      close={() => setCreating(false)} saved={() => {
        setCreating(false)
        setCreated(value => value + 1)
        refresh()
      }} />}
    <AppliedFilters filters={pills} closeOnSubmit>
      <form className="club-staff-game-filters" onSubmit={apply}>
      <label className="club-game-filter-wide">Venue<select value={draft.venueId} onChange={event => setDraft({ ...draft, venueId: event.target.value })}>
        <option value="">All venues</option>
        {venues.map(venue => <option key={venue.id} value={venue.id}>{venueLabel(venue)}</option>)}
      </select></label>
      <label>From date<input type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>Through date<input type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
      <label className="club-game-filter-wide">Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
        <option value="upcoming">Upcoming and in progress</option><option value="">All statuses</option>
        {['published','draft','completed','cancelled'].filter(status => role !== 'facilitator' || status !== 'draft')
          .map(status => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
      </select></label>
      <label className="club-game-filter-wide">Sort by game date<select value={draft.sort} onChange={e => setDraft({ ...draft, sort: e.target.value })}>
        <option value="asc">Earliest first</option><option value="desc">Latest first</option>
      </select></label>
      <div className="club-row-actions"><button type="submit" className="club-button primary">Apply filters</button>
        <button type="button" className="club-button" onClick={() => { setDraft(INITIAL); applyFilters(INITIAL) }}>Clear filters</button></div>
      </form>
      {loadingVenues && <p className="club-note" role="status">Loading venues…</p>}
      <ErrorNotice error={venueError} />
      <MoreOptions noun="venues" options={{ loading: loadingVenues, error: venueError, hasMore: Boolean(venueCursor),
        loadMore: () => loadVenues(venueError ? venueRequest.after : venueCursor ?? undefined) }} />
    </AppliedFilters>
    <ErrorNotice error={listError} />
    {Boolean(listError) && <div className="club-actions">
      {visiblePage && <p className="club-note">Showing the last loaded games.</p>}
      <button type="button" className="club-button" onClick={refresh}>Retry games</button>
    </div>}
    <CollectionTable label="Managed games" headings={['Game', 'Schedule', 'Status', 'Facilitators', 'Actions']}
      count={rows.length} empty={loading ? 'Loading games…' : listError ? 'Games could not be loaded.' : 'No games match these filters.'}
      footer={<CursorPagination label="Game management pages" pageNumber={visiblePage?.number ?? 1} pageSize={25}
        rowCount={rows.length} loading={loading} previous={trail.length ? () => setTrail(items => items.slice(0, -1)) : undefined}
        next={next && !listError ? () => setTrail(items => [...items, next]) : undefined} />}>
      {rows.map(game => <tr key={game.id}>
        <td data-label="Game"><span className="club-cell-stack"><strong>{game.venue}</strong><small>{game.city}</small></span></td>
        <td data-label="Schedule"><span className="club-cell-stack">{dateLabel(game.starts_at)}<small>{timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</small></span></td>
        <td data-label="Status"><RecordStatus value={game.status} /></td>
        <td data-label="Facilitators">{game.facilitators?.map(member => member.name).join(', ') || 'Unassigned'}</td>
        <td data-label="Actions"><GameActions compact game={game} workspace={actionContext} userId={userId} busy={busy || loading} unavailable={Boolean(listError)} action={action}
          open={operation => { if (loading || listError) return; operationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setWorkspace(null); const intent = { game, operation }; selectedIntent.current = intent; setSelection(intent) }} /></td>
      </tr>)}
    </CollectionTable>
    {!selection && <ErrorNotice error={operationError} />}
    {selection && (workspace ? <GameOperationModal operation={selection.operation} workspace={workspace} gameId={selection.game.id}
      busy={busy} error={operationError} action={action} reloadRoster={reloadContext} saved={operationSaved} close={() => { if (selectedIntent.current === selection) close() }} />
      : <Modal title="Game details" close={close}>
        <p className="club-subtitle">{GAME_OPERATION_LABEL[selection.operation]} · {selection.game.venue} · {dateLabel(selection.game.starts_at)} · {timeLabel(selection.game.starts_at)}</p>
        <ErrorNotice error={operationError instanceof TypeError ? new Error('Could not load game details. Check your connection and try again.') : operationError} />
        {operationError ? <button type="button" className="club-button" onClick={() => setOperationRetry(value => value + 1)}>Retry details</button>
          : <Empty>Loading game details…</Empty>}
      </Modal>)}
  </section>
}
