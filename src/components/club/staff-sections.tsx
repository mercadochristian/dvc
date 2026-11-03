'use client'
import { CollectionTable, CollectionTools, SearchField, RecordStatus } from './collection'
import { selectGames } from '@/lib/club/collections'
import { VenueLink } from './venue-link'

import { useState, type FormEvent } from 'react'
import { dateLabel, money, timeLabel, upload } from '@/lib/club/client'
import { POSITION_LABEL, type AccessEntry, type Booking, type ClubGame, type PaymentMethod, type Workspace } from '@/lib/club/types'
import { isAdministrator, managesLineups } from '@/lib/club/permissions'
import { Empty, ErrorNotice, Modal, Warning } from './primitives'

type Save = (action: string, data: unknown) => Promise<boolean | void>

export function StaffGames({ workspace, busy, roster, edit, cancel }: {
  workspace: Workspace; busy: boolean; roster: (id: string) => void
  edit: (game: ClubGame) => void; cancel: (id: string) => void
}) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [order, setOrder] = useState('soonest')
  const admin = isAdministrator(workspace.role), games = selectGames(workspace.games,query,status,order)
  return <><CollectionTools count={games.length} noun="games"><SearchField label="Search games" placeholder="Search venue or city" value={query} change={setQuery}/><label className="club-filter"><span className="club-sr-only">Game status</span><select aria-label="Game status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['published','draft','completed','cancelled'].map(value=><option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></label><label className="club-filter"><span className="club-sr-only">Sort games</span><select aria-label="Sort games" value={order} onChange={e=>setOrder(e.target.value)}><option value="soonest">Soonest first</option><option value="latest">Latest first</option></select></label></CollectionTools>
    <CollectionTable label="Games" headings={['Game','Date','Status','Players','Actions']} count={games.length} empty={workspace.games.length ? 'No games match these filters.' : 'No games yet.'}>
      {games.map(game=><tr key={game.id}><td data-label="Game"><span className="club-cell-stack"><strong><VenueLink name={game.venue} mapsUrl={game.maps_url}/></strong><small>{game.city}</small></span></td><td data-label="Date"><span className="club-cell-stack">{dateLabel(game.starts_at)}<small>{timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</small></span></td><td data-label="Status"><RecordStatus value={game.status}/></td><td data-label="Players" className="club-numeric">{workspace.roster.filter(player=>player.game_id===game.id).length}</td><td data-label="Actions"><div className="club-row-actions">{managesLineups(workspace.role)&&<button className="club-button" onClick={()=>roster(game.id)}>Roster</button>}{admin&&game.status!=='cancelled'&&<><button className="club-button" disabled={busy} onClick={()=>edit(game)}>Edit</button><button className="club-button quiet danger" disabled={busy} onClick={()=>cancel(game.id)}>Cancel</button></>}</div></td></tr>)}
    </CollectionTable></>
}

export { LineupBoard as StaffRoster } from './lineup-board'

export function AccessForm({ entry, busy, developer = false, save }: { entry?: AccessEntry; busy: boolean; developer?: boolean; save: (data: unknown) => void }) {
  return <form className="club-access-row" aria-label={entry?.email || 'Add staff email'} onSubmit={event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    save({ ...(entry ? { id: entry.id } : {}), email: data.get('email'), role: data.get('role'), enabled: data.get('enabled') === 'on' })
  }}>
    <label>Email{entry && <small>{entry.registered ? 'Registered account' : 'Applied when they sign in'}</small>}<input disabled={entry?.role === 'developer' && !developer} name="email" type="email" required maxLength={254} defaultValue={entry?.email} /></label>
    <label>Role<select disabled={entry?.role === 'developer' && !developer} name="role" defaultValue={entry?.role || 'facilitator'}><option value="facilitator">Facilitator</option><option value="coordinator">Coordinator</option><option value="admin">Administrator</option>{(developer || entry?.role === 'developer') && <option value="developer">Developer</option>}</select></label>
    <label className="club-check"><input disabled={entry?.role === 'developer' && !developer} type="checkbox" name="enabled" defaultChecked={entry?.enabled ?? true} /> Enabled</label>
    <button className="club-button" disabled={busy || (entry?.role === 'developer' && !developer)}>{entry ? 'Save' : 'Add email'}</button>
  </form>
}

export function PaymentReview({ booking, games, methods, busy, action, transfer, saved, actionError }: {
  booking: Booking; games: ClubGame[]; methods: PaymentMethod[]; busy: boolean
  action: Save; actionError?: unknown; transfer: () => void; saved: () => void
}) {
  const [decision, setDecision] = useState<'approve' | 'reject' | 'cancel' | null>(null)
  const [error, setError] = useState<unknown>(null), [uploading, setUploading] = useState(false)
  const game = games.find(game => game.id === booking.game_id)
  async function receipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    data.set('kind', 'receipt'); data.set('booking', booking.id)
    setUploading(true); setError(null)
    try { await upload(data); saved() } catch (error) { setError(error) } finally { setUploading(false) }
  }
  return <article className="club-panel club-payment-review">
    <header className="club-payment-heading"><div><h2>{booking.captain_name}</h2><p><VenueLink name={game?.venue || 'Venue'} mapsUrl={game?.maps_url} /> · {booking.kind === 'team' ? 'Team of 6' : 'Individual'}</p></div><strong>{money(booking.amount)}</strong></header>
    <div className="club-payment-meta"><p>{booking.contact}</p><span className={`club-badge ${booking.payment_status === 'approved' ? '' : booking.payment_status === 'rejected' ? 'danger' : 'neutral'}`}>Payment {booking.payment_status}</span></div>
    <small className="club-note club-booking-reference">Booking ID: <code>{booking.id}</code></small>
    <ErrorNotice error={error} />
    <div className="club-actions club-receipt-actions">
      {booking.receipt && <a className="club-button" href={`/api/club/asset?kind=receipt&id=${booking.id}`} target="_blank" rel="noreferrer">View receipt</a>}
      {booking.receipt && booking.payment_status === 'pending' && <>
        <button className="club-button primary" disabled={busy} onClick={() => setDecision('approve')}>Approve</button>
        <button className="club-button danger" disabled={busy} onClick={() => setDecision('reject')}>Reject</button>
      </>}
    </div>
    {!booking.receipt && <form className="club-form club-manual-receipt" onSubmit={receipt}>
      <label>Payment method<select name="method" required>{methods.filter(method => method.enabled).map(method => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
      <label>Receipt<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required /></label>
      <button className="club-button" disabled={uploading || !methods.some(method => method.enabled)}>{uploading ? 'Uploading…' : 'Add receipt'}</button>
    </form>}
    <footer className="club-actions club-booking-actions">
      <button className="club-button" disabled={busy} onClick={transfer}>Transfer</button>
      <button className="club-button danger" disabled={busy} onClick={() => setDecision('cancel')}>Cancel booking</button>
    </footer>
    {decision && <Modal title={decision === 'approve' ? 'Approve receipt' : decision === 'reject' ? 'Reject receipt' : 'Cancel booking'} close={() => setDecision(null)}><ErrorNotice error={actionError} /><form className="club-form" onSubmit={event => { event.preventDefault(); const note = new FormData(event.currentTarget).get('note'); void action(decision === 'cancel' ? 'booking.cancel' : `receipt.${decision}`, { id: booking.id, ...(decision === 'reject' ? { note } : {}) }).then(ok => { if (ok !== false) setDecision(null) }) }}><div className="club-confirm-summary"><strong>{booking.captain_name}</strong><span><VenueLink name={game?.venue || 'Venue'} mapsUrl={game?.maps_url}/>{game && ` · ${dateLabel(game.starts_at)} · ${timeLabel(game.starts_at)}`}</span><span>{booking.kind==='team'?'Team of 6':'Individual'} · {money(booking.amount)}</span></div>{decision !== 'approve' && <Warning>This releases the reserved positions. Handle any refund separately.</Warning>}{decision === 'reject' && <label>Reason<textarea name="note" required minLength={3} maxLength={300} /></label>}<button className={`club-button ${decision === 'approve' ? 'primary' : 'danger'}`} disabled={busy}>{decision === 'approve' ? 'Approve receipt' : decision === 'reject' ? 'Reject receipt' : 'Cancel booking'}</button></form></Modal>}
  </article>
}
