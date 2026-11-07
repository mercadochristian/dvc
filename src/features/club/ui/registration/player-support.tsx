'use client'
import { RequiredLabel } from '../shared/required'
import { useState } from 'react'
import { dateLabel } from '@/features/club/model/format'
import { selectRegistrations } from '@/features/club/model/collections'
import type { SupportRegistration, Workspace } from '@/features/club/model/types'
import { AppliedFilters } from '../shared/applied-filters'
import { CollectionTable, RecordStatus } from '../shared/collection'
import { ErrorNotice, Modal } from '../shared/primitives'
import { VenueLink } from '../shared/venue-link'
type Action = (name: string, data: unknown) => Promise<boolean | void>
export function PlayerSupport({workspace,busy,action,add,actionError,scoped=false}:{workspace:Workspace;busy:boolean;action:Action;actionError?:unknown} & ({ scoped: true; add?: never } | { scoped?: false; add: () => void })) {
  const [gameId,setGameId]=useState(''),[status,setStatus]=useState(''),[editing,setEditing]=useState<SupportRegistration|null>(null),[error,setError]=useState<unknown>(null),[attempted,setAttempted]=useState(false)
  const registrations=workspace.support||[],rows=selectRegistrations(registrations,workspace.games,'',gameId,status)
  const selectedGame = workspace.games.find(game => game.id === gameId)
  const statusFilter = <label className="club-scoped-status-filter">Registration status
    <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['reserved','holding','cancelled','rejected','expired'].map(s=><option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}</select>
  </label>
  return <>{!scoped && <div className="club-section-heading"><h2>Player support</h2><button type="button" className="club-button primary" onClick={add}>Add registration</button></div>}
    {scoped ? statusFilter : <AppliedFilters filters={[
      ...(status ? [{ key: 'status', label: status[0].toUpperCase() + status.slice(1), remove: () => setStatus('') }] : []),
      ...(selectedGame ? [{ key: 'game', label: `${selectedGame.venue} · ${dateLabel(selectedGame.starts_at)}`, remove: () => setGameId('') }] : []),
    ]}><div className="club-filter-fields"><select aria-label="Registration game" value={gameId} onChange={e=>setGameId(e.target.value)}><option value="">All games</option>{workspace.games.map(g=><option key={g.id} value={g.id}>{g.venue} · {dateLabel(g.starts_at)}</option>)}</select>{statusFilter}</div></AppliedFilters>}

    <CollectionTable label="Registrations" headings={['Player', ...(!scoped ? ['Game'] : []), 'Registration','Status','Actions']} count={rows.length} empty={registrations.length ? 'No matching registrations.' : 'No registrations yet.'}>{rows.map(b=>{const g=workspace.games.find(g=>g.id===b.game_id);return <tr key={b.id}><td data-label="Player"><span className="club-cell-stack"><strong>{b.captain_name}</strong><small>{b.contact}</small></span></td>{!scoped && <td data-label="Game"><span className="club-cell-stack"><VenueLink name={g?.venue||'Venue'} mapsUrl={g?.maps_url}/><small>{g&&dateLabel(g.starts_at)}</small></span></td>}<td data-label="Registration">{b.kind==='team'?'Team registration':b.kind==='group'?'Group registration':'Individual'}</td><td data-label="Status"><RecordStatus value={b.status}/></td><td data-label="Actions"><button type="button" className="club-button" aria-label={`Edit details for ${b.captain_name}`} disabled={busy} onClick={()=>{setError(null);setAttempted(false);setEditing(b)}}>Edit details</button></td></tr>})}</CollectionTable>
    {editing&&<Modal title="Edit registration" close={()=>setEditing(null)} dismissible={!busy}><ErrorNotice error={attempted?(actionError||error):null}/><form className="club-form" onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);setError(null);setAttempted(true);void action('booking.details',{id:editing.id,name:f.get('name'),contact:f.get('contact')}).then(ok=>{if(ok!==false)setEditing(null);else setError(new Error('Details were not saved. Check the workspace message and try again.'))}).catch(setError)}}><label><RequiredLabel>Name</RequiredLabel><input name="name" required maxLength={100} defaultValue={editing.captain_name}/></label><label><RequiredLabel>Email or phone</RequiredLabel><input name="contact" required minLength={3} maxLength={160} defaultValue={editing.contact}/></label><button className="club-button primary" disabled={busy}>Save details</button></form></Modal>}</>
}
