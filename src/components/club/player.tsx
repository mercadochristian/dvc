'use client'
import { VenueLink } from './venue-link'
import { GameTable } from './game-table'
import { CollectionTable, CollectionTools, SearchField } from './collection'
import { matchesSearch } from '@/lib/club/collections'
import { useCallback, useEffect, useState } from 'react'
import { addDays, dateLabel, monday, money, manilaDate, read, timeLabel } from '@/lib/club/client'
import { POSITIONS, POSITION_LABEL, type Booking, type ClubGame, type ClubSession, type RosterEntry } from '@/lib/club/types'
import { ClubIcon, Chevron, Empty, ErrorNotice, Modal, Toast } from './primitives'
import { Registration } from './registration'

export function Player({ session, view }: { session: ClubSession; view: 'games' | 'bookings' }) {
  const [from, setFrom] = useState(monday), [games, setGames] = useState<ClubGame[]>([]), [bookings, setBookings] = useState<Booking[]>([])
  const [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [registration, setRegistration] = useState<{ game?: ClubGame; booking?: Booking } | null>(null)
  const [roster, setRoster] = useState<{ game: ClubGame; entries: RosterEntry[] } | null>(null), [refresh, setRefresh] = useState(0), [day, setDay] = useState('all')
  const [notice, setNotice] = useState(''), [query,setQuery]=useState(''),[positionFilter,setPositionFilter]=useState(''),[layout,setLayout]=useState<'agenda'|'table'>('agenda')
  useEffect(() => {
    let current = true; setLoading(true); setError(null); setGames([]); setBookings([])
    const request = view === 'games' ? read<ClubGame[]>('schedule', { from, to: addDays(from, 7) }).then(v => { if (current) setGames(v) }) : read<Booking[]>('mine').then(v => { if (current) setBookings(v) })
    request.catch(e => { if (current) setError(e) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [from, view, refresh])
  // Read again when the player returns; no Sheets calls or continuous polling.
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') setRefresh(v => v + 1) }; document.addEventListener('visibilitychange', refresh); return () => document.removeEventListener('visibilitychange', refresh) }, [])
  const players = useCallback(async (game: ClubGame) => { setError(null); try { setRoster({ game, entries: await read<RosterEntry[]>('roster', { game: game.id }) }) } catch (e) { setError(e) } }, [])
  function completed(booking: Booking) { setRegistration(null); setNotice(`Reserved. Payment is under review. Booking ID: ${booking.id}`); setRefresh(v => v + 1) }
  const days = [...new Set(games.map(g => manilaDate(new Date(g.starts_at))))]
  const shownGames=games.filter(g=>(day==='all'||manilaDate(new Date(g.starts_at))===day)&&matchesSearch(query,g.venue,g.city)&&(!positionFilter||g.positions.some(p=>p.position===positionFilter&&p.available>0)))
  return <>
    <div className="club-page-title"><h1>{view === 'games' ? 'Games' : 'My bookings'}</h1><button className="club-button" onClick={() => setRefresh(v => v + 1)}><ClubIcon name="refresh" />Refresh</button></div>
    <ErrorNotice error={error} />
    {notice && <Toast key={notice} message={notice} />}
    {view === 'games' && <div className="club-week"><div className="club-week-navigation"><button className="club-button club-icon-button" aria-label="Previous week" onClick={() => { setFrom(addDays(from, -7)); setDay('all') }}><Chevron direction="left" /></button><label className="club-date-label">Week of<input type="date" value={from} onChange={e => { if (e.target.value) { setFrom(e.target.value); setDay('all') } }} /></label><button className="club-button club-icon-button" aria-label="Next week" onClick={() => { setFrom(addDays(from, 7)); setDay('all') }}><Chevron direction="right" /></button></div><div className="club-day-filters"><button className="club-button" aria-pressed={day === 'all'} onClick={() => setDay('all')}>All week</button>{days.map(d => <button key={d} className="club-button" aria-pressed={day === d} onClick={() => setDay(d)}>{dateLabel(d + 'T12:00:00+08:00')}</button>)}</div></div>}
    {loading ? <Empty>Loading…</Empty> : view === 'games' ? <>
      <CollectionTools count={shownGames.length} noun="games"><SearchField label="Search schedules" placeholder="Search venue or city" value={query} change={setQuery}/><select aria-label="Available position" value={positionFilter} onChange={e=>setPositionFilter(e.target.value)}><option value="">Any position</option>{POSITIONS.map(p=><option value={p} key={p}>{POSITION_LABEL[p]}</option>)}</select><div className="club-view-switch" role="group" aria-label="Schedule layout"><button className="club-button" aria-pressed={layout==='agenda'} onClick={()=>setLayout('agenda')}>Agenda</button><button className="club-button" aria-pressed={layout==='table'} onClick={()=>setLayout('table')}>Table</button></div></CollectionTools>
      {!error && !games.length && <Empty>No games this week. Check another week.</Empty>}
      {!error && !!games.length && !shownGames.length && <Empty>No games match these filters.</Empty>}
      {layout==='table' && !!shownGames.length ? <GameTable games={shownGames} register={game=>setRegistration({game})} players={players}/> : <div className="club-game-grid club-agenda">{shownGames.map(game => {
        const total = game.positions.reduce((n, p) => n + p.available, 0), closed = game.status !== 'published' || Date.parse(game.starts_at) <= Date.now()
        return <article key={game.id} className="club-game-card"><div className="club-game-date" aria-hidden="true"><span>{new Date(game.starts_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short' })}</span><strong>{new Date(game.starts_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: '2-digit' })}</strong><small>{new Date(game.starts_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short' })}</small></div><header><div className="club-inline"><span className="club-sr-only">{dateLabel(game.starts_at)}</span><span className={`club-badge ${closed || !total ? 'neutral' : ''}`}>{closed ? game.status === 'cancelled' ? 'Cancelled' : 'Closed' : total ? `${total} slots left` : 'Full'}</span></div><h2><VenueLink name={game.venue} mapsUrl={game.maps_url} /></h2><p className="club-game-meta"><span>{game.city}</span><span>{timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</span></p>{!!game.facilitators?.length && <p className="club-faci-names">Faci · {game.facilitators.map(f => f.name).join(', ')}</p>}</header><div className="club-position-grid">{POSITIONS.map(p => { const slot = game.positions.find(s => s.position === p); return <div key={p}><span>{POSITION_LABEL[p]}</span><strong>{slot?.available ? `${slot.available} left` : 'Full'}</strong><small>{money(slot?.price || 0)} / player</small></div> })}</div><footer><div className="club-inline"><span>Team of 6</span><strong>{money(game.team_price)} total</strong></div><div className="club-card-actions"><button className="club-button" onClick={() => players(game)}>Players</button><button className="club-button primary" disabled={closed || !total} onClick={() => setRegistration({ game })}>{closed ? 'Closed' : total ? 'Register' : 'Full'}</button></div></footer></article>
      })}</div>}
    </> : <>
      {!session.user && <p className="club-note">Guest bookings from this browser are shown here.</p>}
      {!error && !bookings.length && <Empty>No bookings yet.</Empty>}
      <div className="club-booking-list">{bookings.map(b => { const expired = b.status === 'holding' && Date.parse(b.expires_at) <= Date.now(); return <article className="club-panel" key={b.id}><div className="club-inline"><h2><VenueLink name={b.venue || 'Venue'} mapsUrl={b.maps_url} /></h2><span className="club-badge neutral">{expired ? 'Expired' : b.status === 'reserved' ? 'Reserved' : b.status}</span></div><p>{b.starts_at && dateLabel(b.starts_at)} · {b.starts_at && timeLabel(b.starts_at)} · {b.kind === 'team' ? 'Team of 6' : 'Individual'}</p><div className="club-inline"><strong>{money(b.amount)}</strong>{b.status === 'reserved' && <span>{b.payment_status === 'pending' ? 'Payment under review' : `Payment ${b.payment_status}`}</span>}</div>{!!b.entries?.length && <details className="club-booking-players"><summary>{b.entries.length} player{b.entries.length===1?'':'s'}</summary>{b.entries.map(e => <small className="club-entry" key={e.id}>{e.name || 'Player to be named'} · {POSITION_LABEL[e.position]}{e.team ? ` · Team ${e.team}` : ''}</small>)}</details>}{'review_note' in b && typeof b.review_note === 'string' && b.review_note && <p>{b.review_note}</p>}<small className="club-note">Booking ID: <code>{b.id}</code></small>{b.status === 'holding' && !expired && <button className="club-button primary" onClick={() => setRegistration({ booking: b })}>Continue to payment</button>}{b.status === 'reserved' && <small className="club-note">Contact the club for cancellations or transfers.</small>}</article> })}</div>
    </>}
    {registration && <Registration {...registration} session={session} close={() => { setRegistration(null); setRefresh(v => v + 1) }} done={completed} />}
    {roster && <Modal title={<>Players · <VenueLink name={roster.game.venue} mapsUrl={roster.game.maps_url} /></>} close={() => setRoster(null)}><p className="club-subtitle">{dateLabel(roster.game.starts_at)} · {timeLabel(roster.game.starts_at)}</p><CollectionTable label="Registered players" className="club-public-roster" empty="No registered players yet." headings={['Player','Position','Team']} count={roster.entries.length}>{[...roster.entries].sort((a,b)=>POSITIONS.indexOf(a.position)-POSITIONS.indexOf(b.position)).map(entry=><tr key={entry.id}><td data-label="Player"><strong>{entry.name||'Player to be named'}</strong></td><td data-label="Position">{POSITION_LABEL[entry.position]}</td><td data-label="Team">{entry.team?`Team ${entry.team}`:'Unassigned'}</td></tr>)}</CollectionTable></Modal>}
  </>
}
