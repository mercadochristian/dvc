import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { validateAction, validateHold, validatePlayerProfile } from '@/features/club/model/validation'
import { ageOnDate, playerProfileFrom, profileSummary } from '@/features/club/model/player-profile'
import { googleMapsUrl } from '@/features/club/model/maps'
import { LEVEL_LABEL, GENDER_LABEL } from '@/features/club/model/types'
import { PlayerDetails } from '@/features/club/ui/registration/player-details'
import { VenueLink } from '@/features/club/ui/shared/venue-link'
const profile={level:'intermediate',gender:'prefer_not_to_say',birth_date:'2000-02-29',first_timer:true}
const id='11111111-1111-4111-8111-111111111111'
afterEach(()=>vi.useRealTimers())
describe('player balancing details',()=>{
 it('offers the five agreed levels',()=>expect(Object.values(LEVEL_LABEL)).toEqual(['Developmental','Developmental Plus','Intermediate','Intermediate Plus','Advanced']))
 it('offers the three agreed gender choices',()=>expect(Object.values(GENDER_LABEL)).toEqual(['Male','Female','Prefer not to say']))
 it.each(Object.keys(LEVEL_LABEL))('accepts level %s',level=>expect(validatePlayerProfile({...profile,level}).level).toBe(level))
 it.each(Object.keys(GENDER_LABEL))('accepts gender %s',gender=>expect(validatePlayerProfile({...profile,gender}).gender).toBe(gender))
 it.each([0,120])('allows boundary age %s',age=>expect(validatePlayerProfile({...profile,birth_date:null,age},false).age).toBe(age))
 it.each([-1,121,25.5,'25',NaN,{},true])('rejects invalid age %s',age=>expect(()=>validatePlayerProfile({...profile,age})).toThrow('Check age'))
 it.each(['level','gender','birth_date','first_timer'])('requires %s',key=>expect(()=>validatePlayerProfile({...profile,[key]:null})).toThrow())
 it.each(['unknown','toString','__proto__',42,{}])('rejects invalid level %s',level=>expect(()=>validatePlayerProfile({...profile,level})).toThrow())
 it.each(['unknown','toString',42,{}])('rejects invalid gender %s',gender=>expect(()=>validatePlayerProfile({...profile,gender})).toThrow())
 it('allows birthday instead of age',()=>expect(validatePlayerProfile({...profile,age:null,birth_date:'2000-02-29'})).toMatchObject({age:null,birth_date:'2000-02-29'}))
 it('rejects both age and birthday',()=>expect(()=>validatePlayerProfile({...profile,age:25,birth_date:'2000-02-29'})).toThrow('not both'))
 it.each(['2025-02-29','2000-02-30','2000-13-01','2000-1-01','2099-01-01','1800-01-01',false,{}])('rejects invalid birthday %s',birth_date=>expect(()=>validatePlayerProfile({...profile,age:null,birth_date})).toThrow('Check birthday'))
 it('uses Manila day at the UTC date boundary',()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T17:00:00Z'));expect(validatePlayerProfile({...profile,age:null,birth_date:'2026-11-03'}).birth_date).toBe('2026-11-03')})
 it('permits unknown values for existing staff-edited profiles',()=>expect(validatePlayerProfile({},false)).toEqual({level:null,gender:null,age:null,birth_date:null,first_timer:null}))
 it('does not erase profile on a lineup move',()=>expect(validateAction('roster.update',{id,name:'Ana',team:1,expected_version:0})).not.toHaveProperty('profile'))
 it('rejects invalid partial profile during an edit',()=>expect(()=>validateAction('roster.update',{id,name:'Ana',team:1,expected_version:0,profile:{age:121}})).toThrow('Check age'))
 it('validates named optional teammates',()=>expect(()=>validateHold({...profile,game_id:id,kind:'team',position:'setter',name:'Ana',contact:'test@example.test',teammates:[{name:'Teammate',position:'open'}]})).toThrow('Choose level'))
 it('parses prefixed profile form fields',()=>{const f=new FormData();f.set('p-age','25');f.set('p-level','advanced');f.set('p-gender','male');expect(playerProfileFrom(f,'p-')).toEqual({age:25,level:'advanced',gender:'male',birth_date:null,first_timer:null})})
 it('does not turn blank form ages into zero',()=>expect(playerProfileFrom(new FormData()).age).toBeNull())
 it('shows an age without revealing a birthday in a lineup summary',()=>expect(profileSummary({level:'advanced',age:26,gender:'female',birth_date:'2000-01-01'})).toBe('Advanced · Age 26 · Female'))
 it('calculates the day before a birthday',()=>expect(ageOnDate('2000-11-04','2026-11-03')).toBe(25))
 it('calculates the birthday itself',()=>expect(ageOnDate('2000-11-04','2026-11-04')).toBe(26))
 it('requires birthday for new registrations',()=>expect(renderToStaticMarkup(<PlayerDetails/>)).toMatch(/<input(?=[^>]*type="date")(?=[^>]*name="birth_date")(?=[^>]*required="")/))
 it('uses the birthday input for a stored birthday',()=>expect(renderToStaticMarkup(<PlayerDetails required={false} value={{birth_date:'2000-02-29',age:26}}/>)).toContain('name="birth_date"'))
})
describe('Google Maps venue links',()=>{
 it.each(['https://maps.app.goo.gl/AbCd','https://goo.gl/maps/AbCd','https://www.google.com/maps?q=Makati','https://google.com/maps/place/Court','https://www.google.com.ph/maps/place/Court','https://maps.google.com/?q=Court'])('accepts %s',url=>expect(googleMapsUrl(url)).toBe(new URL(url).href))
 it.each(['https://google.com.evil.test/maps','https://maps.app.goo.gl.evil.test/x','javascript:alert(1)','http://maps.app.goo.gl/x','https://google.com/search?q=court','https://evil@google.com/maps','https://google.com:8080/maps','https://goo.gl/evil','https://example.test/maps','https://maps.app.goo.gl/'+ 'a'.repeat(2050),'not a url'])('rejects %s',url=>expect(googleMapsUrl(url)).toBeNull())
 it.each([null,undefined,'','  '])('supports an optional map URL %s',url=>expect(googleMapsUrl(url)).toBeNull())
 it('normalizes pasted map links',()=>expect(validateAction('venue.save',{name:'Court',city:'Makati',enabled:true,maps_url:' https://google.com/maps?q=Court '}).maps_url).toBe('https://google.com/maps?q=Court'))
 it('preserves omitted links in older payloads',()=>expect(validateAction('venue.save',{name:'Court',city:'Makati',enabled:true})).not.toHaveProperty('maps_url'))
 it('clears an empty venue link',()=>expect(validateAction('venue.save',{name:'Court',city:'Makati',enabled:true,maps_url:''}).maps_url).toBeNull())
 it('rejects invalid venue links before persistence',()=>expect(()=>validateAction('venue.save',{name:'Court',city:'Makati',enabled:true,maps_url:'https://evil.test/'})).toThrow('Google Maps'))
 it('rejects nonstring venue links',()=>expect(()=>validateAction('venue.save',{name:'Court',city:'Makati',enabled:true,maps_url:123})).toThrow('Google Maps'))
 it('renders unavailable maps as plain venue text',()=>expect(renderToStaticMarkup(<VenueLink name="Court" mapsUrl="https://evil.test"/>)).toBe('Court'))
 it('omits an optional standalone map action when no link exists',()=>expect(renderToStaticMarkup(<VenueLink name="Court" label="Open map"/>)).toBe(''))
 it('opens a venue safely in a new tab',()=>expect(renderToStaticMarkup(<VenueLink name="Court" mapsUrl="https://maps.app.goo.gl/x"/>)).toContain('target="_blank" rel="noopener noreferrer"'))
})
