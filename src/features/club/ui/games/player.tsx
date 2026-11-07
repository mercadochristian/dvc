'use client'
import { AppliedFilters } from '../shared/applied-filters'
import { useCallback, useEffect, useRef, useState } from 'react'
import { act, read, RequestError } from '@/features/club/api/client'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { POSITIONS, POSITION_LABEL, type Booking, type Checkout, type ClubGame, type ClubSession, type RosterEntry, type SelectedGamesPage, type Workspace } from '@/features/club/model/types'
import { CollectionTable } from '../shared/collection'
import { Empty, ErrorNotice, Modal, RefreshButton, Toast } from '../shared/primitives'
import { Registration } from '../registration/registration'
import { BookingPlayerEditor } from '../registration/booking-player-editor'
import { playerEditBlock } from '@/features/club/model/booking-player-edit'
import { CheckoutRegistration, type PendingCheckoutIntent } from '../registration/checkout-registration'
import { BookingReference } from '../shared/booking-reference'
import { VenueLink } from '../shared/venue-link'
import { canSelectGame, mergeSelectedSnapshots, toggleSelectedGame, type SelectedGame } from '@/features/club/model/games-selection'
import { GameSelectionControl, SelectedGames } from './game-selection'
import { GameCard } from './game-card'
import { GamesBrowser } from './games-browser'
import { GameActions, GameOperationModal, type GameOperation } from './game-management'
import { restoreCheckoutFocus } from '../registration/checkout-focus'
import { resolvePendingCheckout } from '../registration/checkout-request'
import { RosterRequest } from './roster-request'
import { CheckoutBookingCard, bookingDisplayStatus, checkoutBookingGroups, matchesBookingFilter } from './checkout-bookings'

export function Player({ session, view, browseGames }: { session: ClubSession; view: 'games' | 'bookings'; browseGames: () => void }) {
  const [games, setGames] = useState<ClubGame[]>([]), [bookings, setBookings] = useState<Booking[]>([])
  const [editingPlayers, setEditingPlayers] = useState<Booking | null>(null)
  const workspaceScope = session.user && session.role !== 'player' ? `${session.user.id}:${session.role}` : null
  const [staffWorkspace, setStaffWorkspace] = useState<{ scope: string; value: Workspace } | null>(null)
  const workspace = staffWorkspace?.scope === workspaceScope ? staffWorkspace.value : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [registration, setRegistration] = useState<{ booking: Booking } | null>(null)
  const [checkoutRegistration, setCheckoutRegistration] = useState<{ games?: ClubGame[]; checkoutId?: string; recovery?: PendingCheckoutIntent } | null>(null), [pendingCheckout, setPendingCheckout] = useState<PendingCheckoutIntent | null>(null)
  const [roster, setRoster] = useState<({ game: ClubGame } & ({ state: 'loading' } | { state: 'ready'; entries: RosterEntry[] } | { state: 'failed'; error: unknown })) | null>(null), [refresh, setRefresh] = useState(0)
  const [bookingStatus, setBookingStatus] = useState('all')
  const [bookingVenue, setBookingVenue] = useState('')
  const [notice, setNotice] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null), [operation, setOperation] = useState<{ gameId: string; name: GameOperation } | null>(null)
  const [selectedGames, setSelectedGames] = useState<SelectedGame[]>([]), [selectionOpen, setSelectionOpen] = useState(false)
  const [rosterRequest] = useState(() => new RosterRequest())
  const selectionDock = useRef<HTMLElement>(null)
  const continueRegistration = useRef<HTMLButtonElement>(null)
  const selectionTrigger = useRef<HTMLButtonElement>(null), refreshTrigger = useRef<HTMLButtonElement>(null), selectionFocusReturn = useRef(false)
  const dialogTrigger = useRef<HTMLElement | null>(null), bookingFocusReturn = useRef<{ id: string; target: 'checkout' | 'player' } | null>(null), pageHeading = useRef<HTMLHeadingElement>(null), bookingsList = useRef<HTMLDivElement>(null)
  const [loadedRefresh, setLoadedRefresh] = useState(-1)
  const hasDialog = Boolean(selectionOpen || detailId || operation || registration || checkoutRegistration || editingPlayers || roster)
  const showSelection = view === 'games' && selectedGames.length > 0
  useEffect(() => {
    if (!showSelection) return
    const dock = selectionDock.current, workspace = dock?.closest<HTMLElement>('.club-workspace')
    if (!dock || !workspace) return
    // Reserve the measured height after the footer, including wrapped warnings,
    // text zoom and the mobile safe area, so every page control stays reachable.
    const property = '--club-selection-dock-height'
    const previous = workspace.style.getPropertyValue(property)
    const priority = workspace.style.getPropertyPriority(property)
    const measure = () => workspace.style.setProperty(property, `${Math.ceil(dock.getBoundingClientRect().height)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(dock)
    return () => {
      observer.disconnect()
      if (previous) workspace.style.setProperty(property, previous, priority)
      else workspace.style.removeProperty(property)
    }
  }, [showSelection])
  useEffect(() => () => rosterRequest.invalidate(), [rosterRequest])
  useEffect(() => {
    if (bookingFocusReturn.current || hasDialog || (!selectionFocusReturn.current && !dialogTrigger.current)) return
    const frame = requestAnimationFrame(() => {
      const trigger = selectionFocusReturn.current
        ? selectionTrigger.current || refreshTrigger.current
        : dialogTrigger.current?.isConnected ? dialogTrigger.current : refreshTrigger.current
      trigger?.focus(); selectionFocusReturn.current = false; dialogTrigger.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [hasDialog])
  useEffect(() => {
    if (hasDialog || loading || loadedRefresh !== refresh || !bookingFocusReturn.current) return
    const frame = requestAnimationFrame(() => {
      restoreCheckoutFocus(bookingsList.current, pageHeading.current, bookingFocusReturn.current!.id, dialogTrigger.current, document.activeElement, document.body, bookingFocusReturn.current!.target)
      bookingFocusReturn.current = null; dialogTrigger.current = null; selectionFocusReturn.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [hasDialog, loading, loadedRefresh, refresh])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()) }, view === 'bookings' ? 1000 : 30000)
    return () => clearInterval(timer)
  }, [view])
  useEffect(() => {
    if (view !== 'bookings') { setLoading(false); return }
    let current = true; setLoading(true); setError(null)
    read<Booking[]>('mine').then(value => { if (current) setBookings(value) }).catch(error => { if (current) setError(error) }).finally(() => { if (current) { setLoading(false); setLoadedRefresh(refresh) } })
    return () => { current = false }
  }, [view, refresh])
  const receivedGames = useCallback((value: ClubGame[]) => {
    setGames(value); setSelectedGames(selected => mergeSelectedSnapshots(selected, value))
  }, [])
  const selectedRef = useRef(selectedGames)
  selectedRef.current = selectedGames
  const [checkingSelection, setCheckingSelection] = useState(false)
  async function fetchSelections(entries: SelectedGame[]) {
    const responses: SelectedGamesPage[] = []
    for (let offset = 0; offset < entries.length; offset += 100) responses.push(await read<SelectedGamesPage>('selected-games', { ids: entries.slice(offset, offset + 100).map(entry => entry.game.id).join(',') }))
    return mergeSelectedSnapshots(entries, responses.flatMap(page => page.games), responses.flatMap(page => page.missing_ids))
  }
  useEffect(() => {
    if (view !== 'games' || !selectedRef.current.length) return
    let current = true
    const original = selectedRef.current
    fetchSelections(original).then(value => { if (current) setSelectedGames(selected => { const requested = new Map(original.map(entry => [entry.game.id, entry.game])); const accepted = value.filter(entry => selected.some(current => current.game.id === entry.game.id && current.game === requested.get(entry.game.id))); return mergeSelectedSnapshots(selected, accepted.filter(entry => !entry.missing).map(entry => entry.game), accepted.filter(entry => entry.missing).map(entry => entry.game.id)) }) }).catch(error => { if (current) setError(error) })
    return () => { current = false }
  }, [view, refresh])
  useEffect(() => {
    if (!workspaceScope || view !== 'games') return
    let current = true
    read<Workspace>('workspace').then(value => {
      if (current) setStaffWorkspace({ scope: workspaceScope, value })
    }).catch(error => {
      if (!current) return
      if (error instanceof RequestError && (error.status === 401 || error.status === 403)) setStaffWorkspace(null)
      setError(error)
    })
    return () => { current = false }
  }, [workspaceScope, view, refresh])
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); setRefresh(v => v + 1) } }; document.addEventListener('visibilitychange', refresh); return () => document.removeEventListener('visibilitychange', refresh) }, [])
  const registrationIntent = useRef(0)
  function cancelRegistrationCheck() { registrationIntent.current++; setCheckingSelection(false) }
  useEffect(() => { registrationIntent.current++; setCheckingSelection(false); return () => { registrationIntent.current++ } }, [view, session.user?.id])
  function rememberDialogTrigger() {
    cancelRegistrationCheck()
    if (hasDialog || selectionFocusReturn.current) return
    const opener = document.activeElement
    dialogTrigger.current = opener instanceof HTMLElement && opener.isConnected && !opener.closest('dialog') ? opener : null
  }
  function dismissRoster() { rosterRequest.invalidate(); setRoster(null) }
  function openDetails(game: ClubGame) { rememberDialogTrigger(); dismissRoster(); setDetailId(game.id) }
  function players(game: ClubGame) {
    rememberDialogTrigger()
    dismissRoster(); setDetailId(null); setSelectionOpen(false); setRegistration(null); setCheckoutRegistration(null); setOperation(null); setError(null)
    loadPlayers(game)
  }
  function loadPlayers(game: ClubGame) {
    setRoster({ game, state: 'loading' })
    void rosterRequest.load(game, game => read<RosterEntry[]>('roster', { game: game.id }),
      entries => setRoster({ game, state: 'ready', entries }),
      error => setRoster({ game, state: 'failed', error }))
  }
  function completed(booking: Booking) { setRegistration(null); setNotice(`Reserved. Payment is under review. Booking ID: ${booking.id}`); setRefresh(v => v + 1) }
  function checkoutResolved(checkout: Checkout) { setPendingCheckout(current => resolvePendingCheckout(current, checkout)) }
  function checkoutCompleted(checkout: Checkout) {
    checkoutResolved(checkout)
    setCheckoutRegistration(null); setNotice(`Reserved. Payment approved. Checkout reference: ${checkout.id}`)
    const ids = new Set(checkout.bookings.map(booking => booking.game_id))
    setSelectedGames(selected => selected.filter(entry => !ids.has(entry.game.id))); setRefresh(value => value + 1)
  }
  async function reloadRoster() {
    const value = await read<Workspace>('workspace')
    if (workspaceScope) setStaffWorkspace({ scope: workspaceScope, value })
    return value
  }
  async function action(name: string, data: unknown, reportError = setError) {
    if (busy) return false; setBusy(true); setError(null)
    try { await act(name, data); setNotice('Saved'); setRefresh(v => v + 1); return true } catch (e) { reportError(e); return false } finally { setBusy(false) }
  }
  const drafts = (workspace?.games || []).filter(game => game.status === 'draft').map(game => ({ ...game, positions: game.positions.map(position => ({ ...position, available: 0 })) }))
  const allGames = [...games, ...drafts]
  const unavailableSelections = selectedGames.filter(entry => entry.missing || !canSelectGame(entry.game, now)).length
  const bookingVenues = [...new Set(bookings.flatMap(booking => booking.venue ? [booking.venue] : []))].sort((a, b) => a.localeCompare(b))
  const selectedBookingVenue = bookingVenues.includes(bookingVenue) ? bookingVenue : ''
  const checkoutGroups = checkoutBookingGroups(bookings).filter(group => matchesBookingFilter(bookingDisplayStatus(group.status, group.expires_at, now), group.bookings, bookingStatus, selectedBookingVenue))
  const legacyBookings = bookings.filter(booking => !booking.checkout_id && matchesBookingFilter(bookingDisplayStatus(booking.status, booking.expires_at, now), [booking], bookingStatus, selectedBookingVenue))
  const selectedDetail = selectedGames.find(entry => entry.game.id === detailId)
  const details = allGames.find(g => g.id === detailId) || selectedDetail?.game
  useEffect(() => {
    // Removing the last snapshot or refreshing away a game also closes its
    // dialog intent, allowing the existing final-close focus recovery to run.
    if (detailId && !details) {
      setDetailId(null)
      if (!selectedGames.length) setSelectionOpen(false)
    }
  }, [detailId, details, selectedGames.length])
  function gameActions(game: ClubGame) { const staffGame = workspace?.games.find(g => g.id === game.id); return workspace && staffGame ? <GameActions game={staffGame} workspace={workspace} userId={session.user?.id || ''} busy={busy || loading} action={action} open={name => { cancelRegistrationCheck(); dismissRoster(); setDetailId(null); setOperation({ gameId: game.id, name }) }} /> : undefined }
  function focusRegistration() {
    const next = continueRegistration.current
    ;(next && !next.disabled ? next : selectionTrigger.current)?.focus()
  }
  function selection(game: ClubGame, unavailable = false, inDialog = false) { return <GameSelectionControl focusRegistration={inDialog ? undefined : focusRegistration} unavailable={unavailable} game={game} selected={selectedGames.some(entry => entry.game.id === game.id)} now={now} toggle={() => setSelectedGames(selected => toggleSelectedGame(selected, game))} /> }
  async function openRegistration(entries: SelectedGame[], selected = false) {
    if (checkingSelection || !entries.length) return
    rememberDialogTrigger()
    if (pendingCheckout) { setSelectionOpen(false); setDetailId(null); setCheckoutRegistration({ recovery: pendingCheckout }); return }
    setCheckingSelection(true); setError(null)
    const intent = ++registrationIntent.current
    const original = selectedRef.current
    try {
      const refreshed = await fetchSelections(entries)
      if (intent !== registrationIntent.current) return
      if (selected && selectedRef.current.map(entry => entry.game.id).join(',') !== original.map(entry => entry.game.id).join(',')) throw new Error('Your selected games changed. Review them and continue again.')
      setSelectedGames(current => mergeSelectedSnapshots(current, refreshed.filter(entry => !entry.missing).map(entry => entry.game), refreshed.filter(entry => entry.missing).map(entry => entry.game.id)))
      if (refreshed.some(entry => entry.missing || !canSelectGame(entry.game))) throw new Error('A game is no longer available for registration. Review the game details or remove it from your selection.')
      dismissRoster(); setDetailId(null); setSelectionOpen(false); setRegistration(null); setCheckoutRegistration({ games: refreshed.map(entry => entry.game) })
    } catch (error) { if (intent === registrationIntent.current) setError(error) } finally { if (intent === registrationIntent.current) setCheckingSelection(false) }
  }
  function startRegistration(game: ClubGame) { void openRegistration([{ game, missing: false }]) }
  function registerSelected() { void openRegistration(selectedGames, true) }
  function resumeCheckout(id: string) { rememberDialogTrigger(); bookingFocusReturn.current = { id, target: 'checkout' }; dismissRoster(); setDetailId(null); setSelectionOpen(false); setRegistration(null); setCheckoutRegistration({ checkoutId: id }) }
  function editPlayers(booking: Booking) { rememberDialogTrigger(); bookingFocusReturn.current = { id: booking.id, target: 'player' }; setEditingPlayers(booking) }
  function resumePending() { if (!pendingCheckout) return; rememberDialogTrigger(); dismissRoster(); setDetailId(null); setSelectionOpen(false); setRegistration(null); setCheckoutRegistration({ recovery: pendingCheckout }) }
  function showPlayers(game: ClubGame) { players(game) }
  function card(game: ClubGame, unavailable = false, inDialog = false) { return <GameCard key={game.id} game={game} players={() => showPlayers(game)} actions={gameActions(game)} selection={selection(game, unavailable, inDialog)} unavailable={unavailable} inDialog={inDialog} now={now} /> }
  return <>
    <div className="club-page-title"><h1 ref={pageHeading} tabIndex={-1}>{view === 'games' ? 'Games' : 'My bookings'}</h1><RefreshButton buttonRef={refreshTrigger} onClick={() => setRefresh(v => v + 1)} /></div>
    <ErrorNotice error={error} />{notice && <Toast key={`${notice}-${refresh}`} message={notice} />}
    {checkingSelection && <div className="club-inline" role="status"><span>Checking selected games…</span><button type="button" className="club-button" onClick={cancelRegistrationCheck}>Cancel check</button></div>}
    {pendingCheckout && <section className="club-selection-summary" aria-label="Pending reservation status"><div><h2>Check your previous reservation</h2><p className="club-note">Its result is not confirmed yet. Resolve this request before starting another checkout.</p></div><button className="club-button" onClick={resumePending}>Check reservation</button></section>}
    {view === 'games' && <p className="club-sr-only" role="status">{selectedGames.length ? `${selectedGames.length} ${selectedGames.length === 1 ? 'game' : 'games'} selected` : 'No games selected'}</p>}
    {showSelection && <section ref={selectionDock} className="club-selection-summary club-selection-dock" aria-label="Game selection"><div><h2>Selected games ({selectedGames.length})</h2><p className="club-note">Selecting games does not reserve slots.</p>{unavailableSelections > 0 && <p className="club-selection-warning">{unavailableSelections} selected game{unavailableSelections === 1 ? ' is' : 's are'} no longer available.</p>}</div><div className="club-row-actions"><button type="button" className="club-button" ref={selectionTrigger} onClick={() => { cancelRegistrationCheck(); dismissRoster(); selectionFocusReturn.current = true; setSelectionOpen(true) }}>View selected games</button><button type="button" className="club-button primary" ref={continueRegistration} disabled={checkingSelection || (!pendingCheckout && unavailableSelections > 0)} onClick={registerSelected}>{pendingCheckout ? 'Check reservation' : 'Continue to registration'}</button></div></section>}
    {view === 'games' ? <GamesBrowser refresh={refresh} now={now} snapshots={receivedGames} card={game => card(game)} register={startRegistration} players={showPlayers} details={openDetails} selection={selection} drafts={drafts} /> : loading && loadedRefresh < 0 ? <Empty>Loading bookings…</Empty> : <>
      {loading && <p className="club-sr-only" role="status">Refreshing bookings…</p>}
      {!session.user && <p className="club-note">Guest bookings from this browser are shown here.</p>}
      {!error && !bookings.length && <Empty action={<button type="button" className="club-button primary" onClick={browseGames}>Browse games</button>}>No bookings yet.</Empty>}
      {bookings.length > 0 && <AppliedFilters liveResults filters={[
        ...(selectedBookingVenue ? [{ key: 'venue', label: selectedBookingVenue, remove: () => setBookingVenue('') }] : []),
        ...(bookingStatus !== 'all' ? [{ key: 'status', label: bookingStatus === 'holding' ? 'Awaiting payment' : bookingStatus[0].toUpperCase() + bookingStatus.slice(1), remove: () => setBookingStatus('all') }] : []),
      ]}><div className="club-booking-filters" role="group" aria-label="Filter bookings">
        <label>Venue<select value={selectedBookingVenue} onChange={event => setBookingVenue(event.target.value)}>
          <option value="">All venues</option>
          {bookingVenues.map(venue => <option key={venue} value={venue}>{venue}</option>)}
        </select></label>
        <label>Status<select value={bookingStatus} onChange={event => setBookingStatus(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="holding">Awaiting payment</option>
          <option value="reserved">Reserved</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
          <option value="rejected">Rejected</option>
        </select></label>
      </div></AppliedFilters>}
      {bookings.length > 0 && !checkoutGroups.length && !legacyBookings.length && <div className="club-booking-no-match">
        <Empty>No bookings match these filters.</Empty>
        <button type="button" className="club-button" onClick={() => { setBookingStatus('all'); setBookingVenue('') }}>Clear filters</button>
      </div>}
      <div className="club-booking-list" ref={bookingsList}>{checkoutGroups.map(group => <CheckoutBookingCard key={group.id} group={group} now={now} open={() => resumeCheckout(group.id)} editPlayers={editPlayers} />)}{legacyBookings.map(b => { const expired = b.status === 'holding' && Date.parse(b.expires_at) <= now; return <article className="club-panel" key={b.id}><div className="club-inline"><h2><VenueLink name={b.venue || 'Venue'} mapsUrl={b.maps_url} /></h2><span className="club-badge neutral">{expired ? 'Expired' : b.status === 'reserved' ? 'Reserved' : b.status}</span></div><p>{b.starts_at && dateLabel(b.starts_at)} · {b.starts_at && timeLabel(b.starts_at)} · {b.kind === 'team' ? 'Team of 6' : 'Individual'}</p><div className="club-inline"><strong>{money(b.amount)}</strong>{b.status === 'reserved' && <span>{b.payment_status === 'pending' ? 'Payment under review' : `Payment ${b.payment_status}`}</span>}</div><details className="club-booking-disclosure"><summary>Booking details</summary>{Boolean(b.entries?.length) && <ul className="club-booking-roster" aria-label="Players">{b.entries?.map(entry => <li className="club-entry" key={entry.id}>{entry.name || 'Player to be named'} · {POSITION_LABEL[entry.position]}{entry.team ? ` · Team ${entry.team}` : ''}</li>)}</ul>}{Boolean(b.entries?.length) && <><button type="button" className="club-button" data-booking-player-edit={b.id} disabled={Boolean(playerEditBlock(b, now))} onClick={() => editPlayers(b)}>Edit player details</button><small className="club-note">{playerEditBlock(b, now) || 'Player details lock one hour before the game.'}</small></>}{'review_note' in b && typeof b.review_note === 'string' && b.review_note && <p>{b.review_note}</p>}<BookingReference label="Booking ID" value={b.id} /></details>{b.status === 'holding' && !expired && <p className="club-note" role="timer">Hold remaining: {Math.floor(Math.max(0, Math.ceil((Date.parse(b.expires_at) - now) / 1000)) / 60)}:{String(Math.max(0, Math.ceil((Date.parse(b.expires_at) - now) / 1000)) % 60).padStart(2, '0')}</p>}{b.status === 'holding' && !expired && <button className="club-button primary" onClick={() => setRegistration({ booking: b })}>Continue to payment</button>}{b.status === 'reserved' && <small className="club-note">Contact the club for cancellations or transfers.</small>}</article> })}</div>
    </>}
    {selectionOpen && <Modal title={`Selected games (${selectedGames.length})`} close={() => { cancelRegistrationCheck(); setSelectionOpen(false) }}><ErrorNotice error={error} />{checkingSelection && <p role="status">Checking selected games…</p>}<SelectedGames now={now} selected={selectedGames} open={openDetails} remove={id => setSelectedGames(selected => selected.filter(entry => entry.game.id !== id))} />{selectedGames.length > 0 && <button type="button" className="club-button primary" disabled={checkingSelection || (!pendingCheckout && unavailableSelections > 0)} onClick={registerSelected}>{pendingCheckout ? 'Check reservation' : 'Continue to registration'}</button>}</Modal>}
    {details && <Modal title={`Game · ${dateLabel(details.starts_at)}`} close={() => { cancelRegistrationCheck(); setDetailId(null) }}><ErrorNotice error={error} />{checkingSelection && <p role="status">Checking game…</p>}{card(details, !!selectedDetail?.missing, true)}</Modal>}
    {workspace && operation && <GameOperationModal key={`${operation.gameId}-${operation.name}`} operation={operation.name} gameId={operation.gameId} workspace={workspace} busy={busy} error={error} action={action} reloadRoster={reloadRoster} saved={() => { setNotice('Saved'); setRefresh(v => v + 1) }} close={() => setOperation(null)} />}
    {editingPlayers && <BookingPlayerEditor booking={editingPlayers} now={now} close={refreshNeeded => { setEditingPlayers(null); if (refreshNeeded) setRefresh(value => value + 1) }} saved={() => { setEditingPlayers(null); setNotice('Player details saved'); setRefresh(value => value + 1) }} />}
    {checkoutRegistration && <CheckoutRegistration {...checkoutRegistration} session={session} pending={setPendingCheckout} resolved={checkoutResolved} close={() => { setCheckoutRegistration(null) }} done={checkoutCompleted} />}
    {registration && <Registration {...registration} session={session} close={() => { setRegistration(null) }} done={completed} />}
    {roster && <Modal title={<>Players · <VenueLink name={roster.game.venue} mapsUrl={roster.game.maps_url} /></>} close={dismissRoster}><p className="club-subtitle">{dateLabel(roster.game.starts_at)} · {timeLabel(roster.game.starts_at)}</p>{roster.state === 'loading' ? <Empty>Loading players…</Empty> : roster.state === 'failed' ? <div className="club-form">
      <ErrorNotice error={roster.error || new Error('Could not load registered players.')} />
      <div className="club-actions"><button type="button" className="club-button" onClick={() => loadPlayers(roster.game)}>Try again</button></div>
    </div> : <CollectionTable label="Registered players" className="club-public-roster" empty="No registered players yet." headings={['Player','Position','Team']} count={roster.entries.length}>{[...roster.entries].sort((a,b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)).map(entry => <tr key={entry.id}><td data-label="Player"><strong>{entry.name || 'Player to be named'}</strong></td><td data-label="Position">{POSITION_LABEL[entry.position]}</td><td data-label="Team">{entry.team ? `Team ${entry.team}` : 'Unassigned'}</td></tr>)}</CollectionTable>}</Modal>}
  </>
}
