'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { read } from '@/features/club/api/client'
import { dateLabel, manilaDate } from '@/features/club/model/format'
import { POSITIONS, POSITION_LABEL, type ClubGame, type GamesPage, type PublicGameVenue, type PublicGameVenuesPage } from '@/features/club/model/types'
import { AppliedFilters } from '../shared/applied-filters'
import { CursorPagination } from '../shared/cursor-pagination'
import { MoreOptions } from '../shared/management-options'
import { Empty, ErrorNotice } from '../shared/primitives'
import { GameTable } from './game-table'

const GAMES_PAGE_SIZE = 12 // Matches the public browse RPC page limit.
const emptyFilters = { date: '', venue: '', position: '', completed: false, cancelled: false }
export function GamesBrowser({ refresh, now, snapshots, card, register, players, details, selection, drafts = [] }: {
  refresh: number; now: number; snapshots: (games: ClubGame[]) => void; card: (game: ClubGame) => ReactNode
  register: (game: ClubGame) => void; players: (game: ClubGame) => void; details: (game: ClubGame) => void
  selection: (game: ClubGame) => ReactNode; drafts?: ClubGame[]
}) {
  const [filters, setFilters] = useState(emptyFilters), [layout, setLayout] = useState<'list' | 'table'>('list')
  const [cursors, setCursors] = useState<string[]>([]), [page, setPage] = useState<{ value: GamesPage; key: string; number: number } | null>(null)
  const [venues, setVenues] = useState<PublicGameVenue[]>([]), [venueError, setVenueError] = useState<unknown>(null)
  const [venueRetry, setVenueRetry] = useState(0)
  const venueField = useRef<HTMLSelectElement>(null), moreVenuesButton = useRef<HTMLButtonElement>(null)
  const [venueCursor, setVenueCursor] = useState<string | null>(null), [loadingVenues, setLoadingVenues] = useState(false)
  const [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0)
  const after = cursors.at(-1) || ''
  const pageNumber = cursors.length + 1
  const params = { ...filters, completed: filters.completed ? '1' : '0', cancelled: filters.cancelled ? '1' : '0', after }
  const key = JSON.stringify(params)
  useEffect(() => {
    let current = true
    setLoading(true); setError(null)
    read<GamesPage>('games', JSON.parse(key)).then(value => {
      if (!current) return
      setPage({ value, key, number: pageNumber }); snapshots(value.games)
    }).catch(error => { if (current) setError(error) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [key, pageNumber, refresh, retry, snapshots])
  useEffect(() => {
    let current = true
    setLoadingVenues(true)
    read<PublicGameVenuesPage>('game-venues').then(value => {
      if (!current) return
      if (!value.next_cursor && document.activeElement === moreVenuesButton.current) venueField.current?.focus()
      setVenues(venues => {
        const merged = new Map([...venues, ...value.venues].map(venue => [venue.id, venue]))
        return [...merged.values()].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      })
      setVenueCursor(value.next_cursor)
      setVenueError(null)
    }).catch(error => { if (current) setVenueError(error) })
      .finally(() => { if (current) setLoadingVenues(false) })
    return () => { current = false }
  }, [refresh, venueRetry])
  async function moreVenues() {
    if (!venueCursor || loadingVenues) return
    setLoadingVenues(true); setVenueError(null)
    try {
      const value = await read<PublicGameVenuesPage>('game-venues', { after: venueCursor })
      setVenues(current => [...new Map([...current, ...value.venues].map(venue => [venue.id, venue])).values()].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)))
      if (!value.next_cursor && document.activeElement === moreVenuesButton.current) venueField.current?.focus()
      setVenueCursor(value.next_cursor)
    } catch (error) { setVenueError(error) } finally { setLoadingVenues(false) }
  }
  function filter<K extends keyof typeof emptyFilters>(name: K, value: typeof emptyFilters[K]) {
    setFilters(current => ({ ...current, [name]: value })); setCursors([])
  }
  const fresh = key === page?.key
  const games = page?.value.games ?? []
  const nextCursor = fresh ? page.value.next_cursor : null
  // Keep API bucket order: ongoing today, future tomorrow, history today must
  // not be regrouped into today's history before tomorrow's upcoming game.
  const groups: { date: string; games: ClubGame[] }[] = []
  for (const game of games) {
    const date = manilaDate(new Date(game.starts_at))
    const previous = groups.at(-1)
    if (previous?.date === date) previous.games.push(game)
    else groups.push({ date, games: [game] })
  }
  const filtered = Object.values(filters).some(Boolean)
  return <section className="club-games-browser" aria-label="Browse games">
    <AppliedFilters liveResults filters={[
      ...(filters.date ? [{ key: 'date', label: dateLabel(`${filters.date}T12:00:00+08:00`), remove: () => filter('date', '') }] : []),
      ...(filters.venue ? [{ key: 'venue', label: venues.find(venue => venue.id === filters.venue)?.name ?? 'Selected venue', remove: () => filter('venue', '') }] : []),
      ...(filters.position ? [{ key: 'position', label: POSITION_LABEL[filters.position as keyof typeof POSITION_LABEL], remove: () => filter('position', '') }] : []),
      ...(filters.completed ? [{ key: 'completed', label: 'Includes completed', remove: () => filter('completed', false) }] : []),
      ...(filters.cancelled ? [{ key: 'cancelled', label: 'Includes cancelled', remove: () => filter('cancelled', false) }] : []),
    ]}><div className="club-games-filters club-filter-fields">
      <label>Game date<input type="date" value={filters.date} onChange={event => filter('date', event.target.value)} /></label>
      <label>Venue<select ref={venueField} value={filters.venue} onChange={event => filter('venue', event.target.value)}><option value="">All venues</option>{venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}{venue.city ? ` · ${venue.city}` : ''}</option>)}</select></label>
        <label>Available position<select value={filters.position} onChange={event => filter('position', event.target.value)}><option value="">Any position</option>{POSITIONS.map(position => <option key={position} value={position}>{POSITION_LABEL[position]}</option>)}</select></label>
        <div className="club-games-history-filters" role="group" aria-label="Include past or cancelled games">
        <label className="club-games-check"><input type="checkbox" checked={filters.completed} onChange={event => filter('completed', event.target.checked)} />Include completed</label>
        <label className="club-games-check"><input type="checkbox" checked={filters.cancelled} onChange={event => filter('cancelled', event.target.checked)} />Include cancelled</label>
        </div>
    </div>
    <ErrorNotice error={venueError} />
    <MoreOptions noun="venues" buttonRef={moreVenuesButton} options={{ loading: loadingVenues, error: venueError, hasMore: Boolean(venueCursor),
      loadMore: () => { if (venueCursor) void moreVenues(); else { setLoadingVenues(true); setVenueError(null); setVenueRetry(value => value + 1) } } }} />
    </AppliedFilters>
    <div className="club-games-toolbar"><p className="club-note" role="status">{loading ? page ? 'Updating games…' : 'Loading games…' : filtered ? 'Filtered games' : 'Upcoming and in progress'}</p><div className="club-row-actions">{filtered && <button type="button" className="club-button" onClick={() => { setFilters(emptyFilters); setCursors([]) }}>Clear filters</button>}<div className="club-view-switch" role="group" aria-label="Schedule layout">{(['list','table'] as const).map(mode => <button type="button" key={mode} className="club-button" aria-pressed={layout === mode} onClick={() => setLayout(mode)}>{mode === 'list' ? 'List' : 'Table'}</button>)}</div></div></div>
    <ErrorNotice error={error} />{error ? <button type="button" className="club-button" onClick={() => setRetry(value => value + 1)}>Retry games</button> : null}
    {!page && loading ? <Empty>Loading games…</Empty> : !games.length && !error ? <Empty>{filtered ? 'No games match these filters.' : 'No upcoming games yet.'}</Empty> : <div aria-busy={loading}>{!fresh && page && <p className="club-note">{error ? 'Showing the last loaded games. Retry to apply your current filters.' : 'Showing the previous results while your filters update.'}</p>}{layout === 'table' ? <GameTable games={games} register={register} players={players} details={details} selection={selection} now={now} /> : <div className="club-schedule-days">{groups.map((group, index) => <section className="club-schedule-day" key={`${group.date}-${index}`}><h2>{dateLabel(`${group.date}T12:00:00+08:00`)}</h2><div className="club-game-grid">{group.games.map(card)}</div></section>)}</div>}</div>}
    <CursorPagination label="Games pages" pageNumber={page?.number ?? 1} pageSize={GAMES_PAGE_SIZE}
      rowCount={games.length} loading={loading}
      previous={cursors.length ? () => setCursors(current => current.slice(0, -1)) : undefined}
      next={nextCursor && !error ? () => setCursors(current => [...current, nextCursor]) : undefined} />
    {!!drafts.length && <section className="club-schedule-day"><h2>Draft games · Staff only</h2><div className="club-game-grid">{drafts.map(card)}</div></section>}
  </section>
}
