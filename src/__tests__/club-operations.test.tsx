import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { canAct, isAdministrator, managesLineups } from '@/lib/club/permissions'
import { canPlace, TEAM_POSITIONS, teammateSlots, teammatesFrom } from '@/lib/club/lineup'
import { validateAction, validateHold } from '@/lib/club/validation'
import { AccessForm, StaffGames } from '@/components/club/staff-sections'
import { FaciAssignments, PlayerSupport } from '@/components/club/operations'
import { Warning } from '@/components/club/primitives'
import type { RosterEntry, StaffRole, Workspace } from '@/lib/club/types'
const id='11111111-1111-4111-8111-111111111111'
const profile={level:'intermediate',age:25,gender:'prefer_not_to_say'}
const base={...profile,game_id:id,kind:'team',position:'setter',name:'Registrant',contact:'test@example.test'}
const player: RosterEntry={id:'one',booking_id:'b1',name:'Ana',position:'setter',team:null,kind:'individual'}
const workspace:Workspace={role:'facilitator',games:[],roster:[]}
const noop=()=>undefined, save=async()=>undefined

describe('cascading single staff role',()=>{
  const roles:StaffRole[]=['player','facilitator','coordinator','admin','developer']
  it.each(roles)('%s has expected lineup access',role=>expect(managesLineups(role)).toBe(['coordinator','admin','developer'].includes(role)))
  it.each(roles)('%s has expected finance access',role=>expect(isAdministrator(role)).toBe(['admin','developer'].includes(role)))
  it.each(['manual.register','booking.details','roster.update','faci.assign','faci.self'])('coordinator can perform support action %s',action=>expect(canAct('coordinator',action)).toBe(true))
  it.each(['game.save','venue.save','venue.delete','payment.save','receipt.approve','access.save'])('coordinator cannot perform administrative action %s',action=>expect(canAct('coordinator',action)).toBe(false))
  it.each(['roster.update','manual.register','booking.details','faci.assign'])('facilitator cannot perform %s',action=>expect(canAct('facilitator',action)).toBe(false))
  it('facilitator can volunteer',()=>expect(canAct('facilitator','faci.self')).toBe(true))
  it('developer inherits finance management',()=>expect(canAct('developer','receipt.approve')).toBe(true))
  it('administrator cannot select Developer in a new whitelist entry',()=>expect(renderToStaticMarkup(<AccessForm busy={false} save={noop}/>)).not.toContain('value="developer"'))
  it('developer can select Developer',()=>expect(renderToStaticMarkup(<AccessForm busy={false} developer save={noop}/>)).toContain('value="developer"'))
  it('facilitator does not see roster actions',()=>expect(renderToStaticMarkup(<StaffGames workspace={workspace} busy={false} roster={noop} edit={noop} cancel={noop}/>)).not.toContain('>Roster</button>'))
})
describe('optional teammate names',()=>{
 it('accepts a team without teammate names',()=>expect(validateHold({...base,teammates:[]}).teammates).toEqual([]))
 it('accepts a partial list',()=>expect(validateHold({...base,teammates:[{...profile,name:'Ana',position:'open'}]}).teammates).toHaveLength(1))
 it('accepts all five remaining positions',()=>expect(validateHold({...base,teammates:teammateSlots('setter').map((p,i)=>({...profile,name:`Player ${i}`,position:p.position}))}).teammates).toHaveLength(5))
 it('rejects an extra player in the registrant position',()=>expect(()=>validateHold({...base,teammates:[{...profile,name:'Ana',position:'setter'}]})).toThrow('Too many'))
 it('rejects too many open spikers',()=>expect(()=>validateHold({...base,teammates:Array.from({length:3},()=>({...profile,name:'Ana',position:'open'}))})).toThrow('Too many'))
 it('rejects teammate fields on individual registration',()=>expect(()=>validateHold({...base,kind:'individual',teammates:[{...profile,name:'Ana',position:'open'}]})).toThrow('Teammates require'))
 it('omits blank optional form fields',()=>expect(teammatesFrom(new FormData(),'setter')).toEqual([]))
 it('keeps five optional slots for every registrant position',()=>expect(['open','opposite','middle','setter'].map(p=>teammateSlots(p as typeof player.position).length)).toEqual([5,5,5,5]))
})
describe('lineup placement',()=>{
 it('defines six fixed position slots',()=>expect(TEAM_POSITIONS).toEqual(['open','open','opposite','middle','middle','setter']))
 it('allows a setter into an empty team',()=>expect(canPlace([],player,1)).toBe(true))
 it('rejects an already occupied setter slot',()=>expect(canPlace([{...player,id:'other',team:1}],player,1)).toBe(false))
 it('does not break an existing team registration',()=>expect(canPlace([{...player,id:'other',position:'open',team:1,kind:'team'}],player,1)).toBe(false))
 it('cannot move a whole registered team to unassigned',()=>expect(canPlace([],{...player,kind:'team'},null)).toBe(false))
 it('cannot merge two registered teams',()=>expect(canPlace([{...player,id:'other',team:1,booking_id:'b2'}],{...player,kind:'team'},1)).toBe(false))
 it('allows moving a whole team to an empty team',()=>expect(canPlace([],{...player,kind:'team'},2)).toBe(true))
})
describe('operation payload boundaries',()=>{
 it('rejects another user on self-volunteering',()=>expect(()=>validateAction('faci.self',{game_id:id,user_id:id,enabled:true})).toThrow('Self-assignment'))
 it('allows selecting another user only through assignment action',()=>expect(validateAction('faci.assign',{game_id:id,user_id:id,enabled:true}).user_id).toBe(id))
 it('normalizes player support name',()=>expect(validateAction('booking.details',{id,name:' Ana ',contact:'ana@example.test'}).name).toBe('Ana'))
 it('does not forward financial fields through support',()=>expect(validateAction('booking.details',{id,name:'Ana',contact:'ana@example.test',amount:1})).not.toHaveProperty('amount'))
 it('does not forward organization spoofing into a venue',()=>expect(validateAction('venue.save',{name:'Court',city:'Makati',enabled:true,organization_id:id})).not.toHaveProperty('organization_id'))
 it('preserves a stale-lineup precondition',()=>expect(validateAction('roster.update',{expected_version:0,id,name:'Ana',team:1,expected_team:null})).toHaveProperty('expected_team',null))
 it('renders warnings as persistent alerts',()=>expect(renderToStaticMarkup(<Warning>Review this</Warning>)).toContain('role="alert"'))
 it('empty support state has a manual registration action',()=>expect(renderToStaticMarkup(<PlayerSupport workspace={{...workspace,role:'coordinator'}} busy={false} action={save} add={noop}/>)).toContain('Add registration'))
 it('empty facilitator schedule explains the state',()=>expect(renderToStaticMarkup(<FaciAssignments workspace={workspace} userId={id} busy={false} action={save}/>)).toContain('No upcoming published games.'))
})

describe('Faci assignment availability',()=>{
 const game={id,venue:'Court',city:'Makati',starts_at:'2099-11-04T10:00:00Z',ends_at:'2099-11-04T13:00:00Z',status:'published' as const,team_price:120000,positions:[],facilitators:[{user_id:id,name:'Assigned Staff'}]}
 const assigned:Workspace={role:'coordinator',games:[game],roster:[],staff:[{id,name:'Assigned Staff',email:'staff@example.test',role:'facilitator'}]}
 it('explains when all eligible staff are already assigned',()=>expect(renderToStaticMarkup(<FaciAssignments workspace={assigned} userId={id} busy={false} action={save}/>)).toContain('No available staff'))
 it('disables assignment when no eligible selection exists',()=>expect(renderToStaticMarkup(<FaciAssignments workspace={assigned} userId={id} busy={false} action={save}/>)).toMatch(/<button[^>]*disabled=""[^>]*>Assign<\/button>/))
})
