import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Registration, RegistrationReview } from '@/features/club/ui/registration/registration'
import { PlayerDetails } from '@/features/club/ui/registration/player-details'
import { TeammateFields } from '@/features/club/ui/registration/teammates'
import { holdSecondsRemaining, registrationDraft } from '@/features/club/model/registration-summary'
import { teammateSlots } from '@/features/club/model/lineup'
import { POSITIONS, type ClubGame, type ClubSession } from '@/features/club/model/types'
const game: ClubGame = { id:'11111111-1111-4111-8111-111111111111', venue:'Fixture Court', city:'Makati', starts_at:'2026-11-04T10:30:00Z', ends_at:'2026-11-04T13:30:00Z', status:'published', team_price:165000, positions:POSITIONS.map(position=>({position,capacity:8,available:8,price:30000})) }
const session: ClubSession={configured:true,user:null,role:'player',developer:false}
const noop=()=>undefined
function form() { const f=new FormData();for(const [k,v] of Object.entries({name:' Ana ',contact:'+639000000000',organizer_email:' ANA@EXAMPLE.TEST ',level:'intermediate',gender:'female',birth_date:'2000-11-05',first_timer:'true'}))f.set(k,v);return f }
afterEach(()=>vi.useRealTimers())
describe('registration review data',()=>{
 it('normalizes public organizer email before review',()=>expect(registrationDraft(form(),game,'individual','setter').data.organizer_email).toBe('ana@example.test'))
 it('requires a confirmation address even with a contact phone',()=>{const f=form();f.delete('organizer_email');expect(()=>registrationDraft(f,game,'individual','setter')).toThrow('email')})
 it('always treats an individual registrant as playing',()=>expect(registrationDraft(form(),game,'individual','setter',false).data.organizer_plays).toBe(true))
 it('previews one individual player and their selected position',()=>expect(registrationDraft(form(),game,'individual','setter').players).toEqual([{name:'Ana',position:'setter'}]))
 it('does not submit a client-calculated amount as authoritative',()=>expect(registrationDraft(form(),game,'individual','setter').data).not.toHaveProperty('amount'))
 it('uses a discounted position amount for the review',()=>expect(registrationDraft(form(),{...game,positions:game.positions.map(p=>({...p,discount_price:25000}))},'individual','setter').amount).toBe(25000))
 it('does not discard a zero-price discount',()=>expect(registrationDraft(form(),{...game,team_discount_price:0},'team','setter').amount).toBe(0))
 it('includes unnamed slots in a playing-organizer team summary',()=>expect(registrationDraft(form(),game,'team','setter').players.filter(p=>!p.name)).toHaveLength(5))
 it('excludes a non-playing organizer from all six player slots',()=>expect(registrationDraft(form(),game,'team','setter',false).players.some(p=>p.name==='Ana')).toBe(false))
 it('includes six slots without organizer balancing data',()=>{const d=registrationDraft(form(),game,'team','setter',false);expect(d.players).toHaveLength(6);expect(d.data).not.toHaveProperty('birth_date')})
 it('retains all six named players with their fixed positions',()=>{const f=form();for(const [i,s] of teammateSlots(null).entries()){f.set(s.key,`Player ${i}`);for(const [k,v] of Object.entries({level:'intermediate',gender:'female',birth_date:'2000-02-29',first_timer:'false'}))f.set(`${s.key}-${k}`,v)}expect(registrationDraft(f,game,'team','setter',false).players.map(p=>p.name)).toEqual(['Player 0','Player 1','Player 2','Player 3','Player 4','Player 5'])})
 it('rejects a named teammate without birthday/details before creating a hold',()=>{const f=form();f.set(teammateSlots(null)[0].key,'Player');expect(()=>registrationDraft(f,game,'team','setter',false)).toThrow('Choose level')})
})
describe('birthday and first-timer form semantics',()=>{
 it('removes the editable age control',()=>expect(renderToStaticMarkup(<PlayerDetails/>)).not.toContain('type="number"'))
 it('marks required birthday visibly',()=>expect(renderToStaticMarkup(<PlayerDetails/>)).toContain('Birthday<span class="club-required"'))
 it('provides explicit first-timer and returnee choices',()=>expect(renderToStaticMarkup(<PlayerDetails/>).match(/name="first_timer"/g)).toHaveLength(2))
 it('prefills a saved returnee choice',()=>expect(renderToStaticMarkup(<PlayerDetails value={{first_timer:false}}/>)).toMatch(/name="first_timer"[^>]*checked=""[^>]*value="false"/))
 it('keeps the calculated age out of the form',()=>expect(renderToStaticMarkup(<PlayerDetails value={{birth_date:'2000-11-05'}} gameDate="2026-11-04T16:30:00Z"/>)).not.toContain('calculated from birthday'))
 it('preserves legacy supplied age without an editable age field',()=>expect(renderToStaticMarkup(<PlayerDetails required={false} value={{age:25}}/>)).toContain('type="hidden" name="age" value="25"'))
 it('does not invent a birthday for a legacy age-only player',()=>expect(renderToStaticMarkup(<PlayerDetails required={false} value={{age:25}}/>)).toMatch(/name="birth_date"[^>]*value=""/))
 it('never submits age alongside an existing birthday',()=>expect(renderToStaticMarkup(<PlayerDetails required={false} value={{birth_date:'2000-02-29',age:26}}/>)).not.toContain('name="age"'))
 it('provides all six optional name fields for a non-playing organizer',()=>expect(renderToStaticMarkup(<TeammateFields position={null}/>).match(/placeholder="Player to be named"/g)).toHaveLength(6))
})
describe('review and hold states',()=>{
 it('explains that review has not reserved capacity',()=>expect(renderToStaticMarkup(<RegistrationReview draft={registrationDraft(form(),game,'individual','setter')} busy={false} edit={noop} confirm={noop}/>)).toContain('No slots are held yet'))
 it('offers editing before the hold',()=>expect(renderToStaticMarkup(<RegistrationReview draft={registrationDraft(form(),game,'individual','setter')} busy={false} edit={noop} confirm={noop}/>)).toContain('Edit details'))
 it('prevents double confirmation while a hold request is active',()=>expect(renderToStaticMarkup(<RegistrationReview draft={registrationDraft(form(),game,'individual','setter')} busy edit={noop} confirm={noop}/>)).toMatch(/<button[^>]*disabled=""[^>]*>Reserving…<\/button>/))
 it('requires review as the first public registration step',()=>expect(renderToStaticMarkup(<Registration game={game} session={session} close={noop} done={noop}/>)).toContain('>Review registration</button>'))
 it('waits for own saved profile before showing editable signed-in fields',()=>expect(renderToStaticMarkup(<Registration game={game} session={{...session,user:{id:'one',name:'Ana',email:'ana@example.test'}}} close={noop} done={noop}/>)).toContain('Loading saved player details'))
 it('shows the required confirmation email field for guests',()=>expect(renderToStaticMarkup(<Registration game={game} session={session} close={noop} done={noop}/>)).toMatch(/<input(?=[^>]*name="organizer_email")(?=[^>]*type="email")(?=[^>]*required="")/))
 it('derives countdown from the original expiry',()=>expect(holdSecondsRemaining('2026-11-03T10:10:00Z',Date.parse('2026-11-03T10:07:30Z'))).toBe(150))
 it('does not restart an expired hold',()=>expect(holdSecondsRemaining('2026-11-03T10:10:00Z',Date.parse('2026-11-03T10:11:00Z'))).toBe(0))
 it('bounds countdown display to ten minutes',()=>expect(holdSecondsRemaining('2026-11-03T11:10:00Z',Date.parse('2026-11-03T10:00:00Z'))).toBe(600))
 it('treats a malformed expiry as expired',()=>expect(holdSecondsRemaining('not a date',Date.now())).toBe(0))
})
