import { describe,expect,it,vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GameCalendar } from '@/features/club/ui/games/calendar'
import { GameCard } from '@/features/club/ui/games/game-card'
import { GameActions } from '@/features/club/ui/games/game-management'
import { UsersTable } from '@/features/club/ui/management/users'
import type { ClubGame, Workspace } from '@/features/club/model/types'
const noop=()=>undefined,action=async()=>true
const game:ClubGame={id:'g',venue:'Test Court',city:'Makati',starts_at:'2099-11-04T10:00:00Z',ends_at:'2099-11-04T13:00:00Z',status:'published',team_price:150000,regular_team_price:165000,positions:[{position:'setter',capacity:4,available:1,price:20000,regular_price:25000}]}
function ws(role:Workspace['role']):Workspace{return{role,games:[game],roster:[]}}
describe('Games milestone',()=>{
 it('renders multiple same-day calendar games as distinct buttons',()=>{const html=renderToStaticMarkup(<GameCalendar from="2099-11-02" games={[game,{...game,id:'g2',venue:'Other Court'}]} select={noop}/>);expect(html.match(/class="club-calendar-game"/g)).toHaveLength(2)})
 it('renders all seven calendar days including empty dates',()=>expect(renderToStaticMarkup(<GameCalendar from="2099-11-02" games={[]} select={noop}/>).match(/No games/g)).toHaveLength(7))
 it('retains a selected day in calendar view',()=>expect(renderToStaticMarkup(<GameCalendar from="2099-11-02" games={[game]} day="2099-11-04" select={noop}/>).match(/class="club-calendar-day"/g)).toHaveLength(1))
 it('shows regular and discounted price accessibly',()=>expect(renderToStaticMarkup(<GameCard game={game} register={noop} players={noop}/>)).toContain('Regular price ₱250'))
 it('disables registration on draft games',()=>expect(renderToStaticMarkup(<GameCard game={{...game,status:'draft'}} register={noop} players={noop}/>)).toMatch(/<button[^>]*disabled=""[^>]*>Draft/))
 it('allows facilitators to volunteer without management controls',()=>{const html=renderToStaticMarkup(<GameActions game={game} workspace={ws('facilitator')} userId="f" busy={false} action={action} open={noop}/>);expect(html).toContain('Volunteer as Facilitator');expect(html).not.toContain('Edit game');expect(html).not.toContain('Roster &amp; lineups')})
 it('offers withdrawal only when the current staff user is assigned',()=>expect(renderToStaticMarkup(<GameActions game={{...game,facilitators:[{user_id:'f',name:'Staff'}]}} workspace={ws('facilitator')} userId="f" busy={false} action={action} open={noop}/>)).toContain('Withdraw as Facilitator'))
 it('keeps finance and cancellation away from coordinators',()=>{const html=renderToStaticMarkup(<GameActions game={game} workspace={ws('coordinator')} userId="c" busy={false} action={action} open={noop}/>);expect(html).toContain('Roster &amp; lineups');expect(html).not.toContain('Payments');expect(html).not.toContain('Cancel game')})
 it('exposes admin cancellation behind More actions',()=>expect(renderToStaticMarkup(<GameActions game={game} workspace={ws('admin')} userId="a" busy={false} action={action} open={noop}/>)).toContain('More actions'))
 it('renders a loading state before the protected Users page arrives',()=>{const html=renderToStaticMarkup(<UsersTable developer={false} busy={false} revision={0} action={action} onAccessLost={noop}/>);expect(html).toContain('Loading users');expect(html).toContain('Search users')})
})
