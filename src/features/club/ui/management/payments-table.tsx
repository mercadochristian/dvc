'use client'
import { useState } from 'react'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { paymentState, PAYMENT_LABEL } from '@/features/club/model/collections'
import type { Booking, ClubGame, PaymentMethod } from '@/features/club/model/types'
import { AppliedFilters } from '../shared/applied-filters'
import { CollectionTable, RecordStatus } from '../shared/collection'
import { Modal } from '../shared/primitives'
import { PaymentReview } from './payment-review'
import { VenueLink } from '../shared/venue-link'
type Action=(name:string,data:unknown)=>Promise<boolean|void>
export function PaymentsTable({bookings,games,methods,busy,action,error,transfer,saved,scoped=false}:{bookings:Booking[];games:ClubGame[];methods:PaymentMethod[];busy:boolean;action:Action;error?:unknown;transfer:(id:string,onSaved:()=>void)=>void;saved:()=>void;scoped?:boolean}) {
  const [status,setStatus]=useState(''),[gameId,setGameId]=useState(''),[selected,setSelected]=useState<string|null>(null)
  const reserved=bookings.filter(b=>b.status==='reserved'),venues=new Map(games.map(g=>[g.id,g]))
  const rows=reserved.filter(b=>(!status||paymentState(b)===status)&&(!gameId||b.game_id===gameId))
  const booking=reserved.find(b=>b.id===selected)
  const selectedGame = venues.get(gameId)
  const statusFilter = <label className="club-scoped-status-filter">Payment status
    <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All payment statuses</option>{Object.entries(PAYMENT_LABEL).filter(([value])=>value!=='rejected').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
  </label>
  return <><div className="club-section-heading">{!scoped && <h2>Payments</h2>}<span className="club-section-total">{money(rows.reduce((sum,b)=>sum+b.amount,0))}<small>Selected reservations · includes unpaid</small></span></div>
    {scoped ? statusFilter : <AppliedFilters filters={[
      ...(status ? [{ key: 'status', label: PAYMENT_LABEL[status], remove: () => setStatus('') }] : []),
      ...(selectedGame ? [{ key: 'game', label: `${selectedGame.venue} · ${dateLabel(selectedGame.starts_at)}`, remove: () => setGameId('') }] : []),
    ]}><div className="club-filter-fields">{statusFilter}<select aria-label="Payment game" value={gameId} onChange={e=>setGameId(e.target.value)}><option value="">All games</option>{games.map(g=><option key={g.id} value={g.id}>{g.venue} · {dateLabel(g.starts_at)}</option>)}</select></div></AppliedFilters>}
    <CollectionTable label="Payments" headings={['Player', ...(!scoped ? ['Game'] : []), 'Registration','Amount','Payment','Actions']} count={rows.length} empty={reserved.length?'No payments match these filters.':'No reserved bookings.'}>{rows.map(b=>{const g=venues.get(b.game_id),state=paymentState(b);return <tr key={b.id}><td data-label="Player"><span className="club-cell-stack"><strong>{b.captain_name}</strong><small>{b.contact}</small></span></td>{!scoped && <td data-label="Game"><span className="club-cell-stack"><VenueLink name={g?.venue||'Venue'} mapsUrl={g?.maps_url}/><small>{g&&`${dateLabel(g.starts_at)} · ${timeLabel(g.starts_at)}`}</small></span></td>}<td data-label="Registration">{b.kind==='team'?'Team registration':b.kind==='group'?'Group registration':'Individual'}</td><td data-label="Amount" className="club-numeric"><strong>{money(b.amount)}</strong></td><td data-label="Payment"><RecordStatus value={state} label={PAYMENT_LABEL[state]}/></td><td data-label="Actions"><button type="button" aria-label={`${state==='review'?'Review payment':'Payment details'} for ${b.captain_name}`} className={`club-button ${state==='review'?'primary':''}`} disabled={busy} onClick={()=>setSelected(b.id)}>{state==='review'?'Review':'Details'}</button></td></tr>})}</CollectionTable>{booking&&<Modal title="Payment details" close={()=>setSelected(null)}><PaymentReview booking={booking} games={games} methods={methods} busy={busy} action={action} actionError={error} transfer={()=>transfer(booking.id,()=>setSelected(null))} saved={saved}/></Modal>}</>
}
