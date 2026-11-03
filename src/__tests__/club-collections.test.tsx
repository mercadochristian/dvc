import { describe,expect,it,vi,afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { matchesSearch,paymentState,selectGames,selectRegistrations } from '@/lib/club/collections'
import { CollectionTable } from '@/components/club/collection'
import { GameTable } from '@/components/club/game-table'
import { AccessTable,PaymentsTable,PaymentMethodsTable } from '@/components/club/staff-tables'
import { Modal } from '@/components/club/primitives'
import type { Booking,ClubGame,SupportRegistration } from '@/lib/club/types'
const games:ClubGame[]=[{id:'late',venue:'North Court',city:'Pasig',starts_at:'2099-11-09T10:00:00Z',ends_at:'2099-11-09T13:00:00Z',status:'published',team_price:165000,positions:[{position:'setter',capacity:4,available:3,price:25000}]},{id:'early',venue:'Riverside Court',city:'Makati',starts_at:'2099-11-04T10:00:00Z',ends_at:'2099-11-04T13:00:00Z',status:'draft',team_price:165000,positions:[]}]
const booking:Booking={id:'b',game_id:'late',captain_name:'Mara Santos',contact:'sample@example.invalid',kind:'individual',amount:25000,status:'reserved',payment_status:'pending',created_at:'2026-11-01',expires_at:'2026-11-01',receipt:null}
const rows:SupportRegistration[]=[{id:'a',game_id:'late',captain_name:'Mara Santos',contact:'sample@example.invalid',kind:'individual',status:'reserved'},{id:'b',game_id:'early',captain_name:'Luis Reyes',contact:'luis@example.invalid',kind:'team',status:'cancelled'}]
const noop=()=>undefined,action=async()=>true
afterEach(()=>vi.useRealTimers())
describe('collection filtering',()=>{
 it('normalizes spaces and case',()=>expect(matchesSearch('  MARA ',null,'Mara Santos',undefined)).toBe(true))
 it('finds an empty search',()=>expect(matchesSearch('','Court')).toBe(true))
 it('keeps unrelated names out of results',()=>expect(matchesSearch('Mara','Luis')).toBe(false))
 it('orders games soonest first',()=>expect(selectGames(games,'').map(g=>g.id)).toEqual(['early','late']))
 it('orders games latest first',()=>expect(selectGames(games,'','','latest').map(g=>g.id)).toEqual(['late','early']))
 it('preserves source game ordering',()=>{selectGames(games,'');expect(games[0].id).toBe('late')})
 it('filters games by city',()=>expect(selectGames(games,' MAKATI ').map(g=>g.id)).toEqual(['early']))
 it('combines game search with status',()=>expect(selectGames(games,'court','published').map(g=>g.id)).toEqual(['late']))
 it('searches registration contact',()=>expect(selectRegistrations(rows,games,'luis@').map(r=>r.id)).toEqual(['b']))
 it('searches the linked venue',()=>expect(selectRegistrations(rows,games,'north').map(r=>r.id)).toEqual(['a']))
 it('combines registration game and status filters',()=>expect(selectRegistrations(rows,games,'','early','reserved')).toEqual([]))
 it('keeps orphan registration names searchable',()=>expect(selectRegistrations(rows,[],'Mara').map(r=>r.id)).toEqual(['a']))
 it('distinguishes no receipt from pending review',()=>expect(paymentState(booking)).toBe('missing'))
 it('marks an uploaded pending receipt for review',()=>expect(paymentState({...booking,receipt:{id:'r',review_note:null}})).toBe('review'))
 it('retains approved payment state',()=>expect(paymentState({...booking,payment_status:'approved'})).toBe('approved'))
 it('retains rejected payment state',()=>expect(paymentState({...booking,payment_status:'rejected'})).toBe('rejected'))
})
describe('table and dialog semantics',()=>{
 it('renders semantic column headers',()=>expect(renderToStaticMarkup(<CollectionTable label="Records" headings={['Name','Actions']} count={1}><tr><td>Ana</td><td>Edit</td></tr></CollectionTable>)).toContain('<th scope="col">Actions</th>'))
 it('renders a useful empty result instead of an empty table',()=>expect(renderToStaticMarkup(<CollectionTable label="Records" headings={['Name']} count={0} empty="No results">{null}</CollectionTable>)).toContain('No results'))
 it('gives nested-capable dialogs distinct title IDs',()=>{const html=renderToStaticMarkup(<><Modal title="One" close={noop}>One</Modal><Modal title="Two" close={noop}>Two</Modal></>);const ids=[...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(2)})
 it('shows position prices before registration in table view',()=>expect(renderToStaticMarkup(<GameTable games={[games[0]]} register={noop} players={noop}/>)).toContain('₱250'))
 it('disables registration for a closed game',()=>expect(renderToStaticMarkup(<GameTable games={[games[1]]} register={noop} players={noop}/>)).toMatch(/<button[^>]*disabled=""[^>]*>Closed<\/button>/))
 it('preserves cancellation status when switching layouts',()=>expect(renderToStaticMarkup(<GameTable games={[{...games[0],status:'cancelled'}]} register={noop} players={noop}/>)).toContain('>Cancelled</span>'))
 it('does not offer a rejected filter on active reservations',()=>expect(renderToStaticMarkup(<PaymentsTable bookings={[{...booking,status:'rejected',payment_status:'rejected'}]} games={games} methods={[]} busy={false} action={action} transfer={noop} saved={noop}/>)).not.toContain('<option value="rejected">'))
 it('disables registration when all positions are full',()=>expect(renderToStaticMarkup(<GameTable games={[{...games[0],positions:[]}]} register={noop} players={noop}/>)).toMatch(/<button[^>]*disabled=""[^>]*>Full<\/button>/))
 it('retains public player actions for a full game',()=>expect(renderToStaticMarkup(<GameTable games={[{...games[0],positions:[]}]} register={noop} players={noop}/>)).toContain('>Players</button>'))
 it('does not claim pending reservations are collected revenue',()=>expect(renderToStaticMarkup(<PaymentsTable bookings={[booking]} games={games} methods={[]} busy={false} action={action} transfer={noop} saved={noop}/>)).toContain('Selected reservations · includes unpaid'))
 it('requires opening a row before approving a receipt',()=>expect(renderToStaticMarkup(<PaymentsTable bookings={[{...booking,receipt:{id:'r',review_note:null}}]} games={games} methods={[]} busy={false} action={action} transfer={noop} saved={noop}/>)).not.toContain('>Approve</button>'))
 it('labels the missing-receipt state in the payments table',()=>expect(renderToStaticMarkup(<PaymentsTable bookings={[booking]} games={games} methods={[]} busy={false} action={action} transfer={noop} saved={noop}/>)).toContain('Awaiting receipt'))
 it('keeps protected Developer access edits disabled for administrators',()=>expect(renderToStaticMarkup(<AccessTable entries={[{id:'d',email:'owner@example.invalid',role:'developer',enabled:true}]} developer={false} busy={false} action={action}/>)).toMatch(/<button[^>]*disabled=""[^>]*>Edit<\/button>/))
 it('allows a Developer to open its access editor',()=>expect(renderToStaticMarkup(<AccessTable entries={[{id:'d',email:'owner@example.invalid',role:'developer',enabled:true}]} developer busy={false} action={action}/>)).not.toMatch(/<button[^>]*disabled=""[^>]*>Edit<\/button>/))
 it('keeps a clear first-run payment method action',()=>expect(renderToStaticMarkup(<PaymentMethodsTable methods={[]} edit={noop}/>)).toContain('Add payment method'))
})
