'use client'
import { RequiredLabel } from '../shared/required'
import { useId, useState } from 'react'
import { googleMapsUrl } from '@/features/club/model/maps'
import { matchesSearch } from '@/features/club/model/collections'
import type { Venue } from '@/features/club/model/types'
import { AppliedFilters } from '../shared/applied-filters'
import { CollectionTable, RecordStatus, SearchField } from '../shared/collection'
import { ErrorNotice, Modal, Warning } from '../shared/primitives'
import { VenueLink } from '../shared/venue-link'
type Action = (name: string, data: unknown) => Promise<boolean | void>
export function VenueManager({ venues, busy, action, error }: { venues: Venue[]; busy: boolean; action: Action; error?: unknown }) {
  const [editing,setEditing]=useState<Venue|'new'|null>(null),[deleting,setDeleting]=useState<Venue|null>(null),[query,setQuery]=useState(''),[status,setStatus]=useState('')
  const mapsErrorId = useId()
  const [mapsInvalid, setMapsInvalid] = useState(false)
  const rows=venues.filter(v=>matchesSearch(query,v.name,v.city)&&(!status||(status==='available'?v.enabled:!v.enabled)))
  return <><div className="club-section-heading"><h2>Venues</h2><button className="club-button primary" onClick={()=>{setMapsInvalid(false);setEditing('new')}}>Add venue</button></div>
    <AppliedFilters filters={[
      ...(query.trim() ? [{ key: 'query', label: `Search: ${query.trim()}`, remove: () => setQuery('') }] : []),
      ...(status ? [{ key: 'status', label: status === 'available' ? 'Available' : 'Archived', remove: () => setStatus('') }] : []),
    ]}><div className="club-filter-fields"><SearchField label="Search venues" placeholder="Search venue or city" value={query} change={setQuery}/><select aria-label="Venue status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All venues</option><option value="available">Available</option><option value="archived">Archived</option></select></div></AppliedFilters>
    <CollectionTable label="Venues" headings={['Venue','City','Status','Actions']} count={rows.length} empty={venues.length?'No venues match these filters.':'Add a venue before creating a game.'}>{rows.map(v=><tr key={v.id}><td data-label="Venue"><strong><VenueLink name={v.name} mapsUrl={v.maps_url}/></strong></td><td data-label="City">{v.city}</td><td data-label="Status"><RecordStatus value={v.enabled?'available':'archived'}/></td><td data-label="Actions"><div className="club-row-actions"><button type="button" className="club-button quiet" aria-label={`Edit ${v.name}`} onClick={()=>{setMapsInvalid(false);setEditing(v)}}>Edit</button>{v.enabled&&<button type="button" className="club-button quiet danger" aria-label={`Delete ${v.name}`} onClick={()=>setDeleting(v)}>Delete</button>}</div></td></tr>)}</CollectionTable>
    {editing&&<Modal title={editing==='new'?'Add venue':'Edit venue'} close={()=>setEditing(null)} dismissible={!busy}><ErrorNotice error={error}/><form className="club-form" onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);void action('venue.save',{...(editing!=='new'?{id:editing.id}:{}),name:f.get('name'),city:f.get('city'),maps_url:f.get('maps_url'),enabled:f.get('enabled')==='on'}).then(ok=>{setMapsInvalid(ok===false && !!f.get('maps_url') && !googleMapsUrl(String(f.get('maps_url'))));if(ok!==false)setEditing(null)})}}><label><RequiredLabel>Venue</RequiredLabel><input name="name" maxLength={120} required defaultValue={editing==='new'?'':editing.name}/></label><label><RequiredLabel>City</RequiredLabel><input name="city" maxLength={120} required defaultValue={editing==='new'?'':editing.city}/></label><label>Google Maps link<input name="maps_url" type="url" aria-invalid={mapsInvalid || undefined} aria-describedby={mapsInvalid ? mapsErrorId : undefined} onChange={()=>setMapsInvalid(false)} maxLength={2048} placeholder="https://maps.app.goo.gl/…" defaultValue={editing==='new'?'':editing.maps_url||''}/><small>Optional · share the venue’s Google Maps link</small>{mapsInvalid&&<small id={mapsErrorId} className="club-error">Use a valid HTTPS Google Maps link</small>}</label><label className="club-check"><input name="enabled" type="checkbox" defaultChecked={editing==='new'||editing.enabled}/> Available for new games</label><button className="club-button primary" disabled={busy}>Save venue</button></form></Modal>}
    {deleting&&<Modal title="Delete venue" close={()=>setDeleting(null)} dismissible={!busy}><ErrorNotice error={error}/><div className="club-form"><Warning>{deleting.name} will be archived if a game uses it. Otherwise it will be permanently deleted. Existing schedules keep their venue details.</Warning><button className="club-button danger" disabled={busy} onClick={()=>void action('venue.delete',{id:deleting.id}).then(ok=>{if(ok!==false)setDeleting(null)})}>Delete venue</button></div></Modal>}</>
}
