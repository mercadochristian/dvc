'use client'
import { CollectionTable, CollectionTools, SearchField, RecordStatus } from '../shared/collection'
import { selectGames } from '@/features/club/model/collections'
import { VenueLink } from '../shared/venue-link'
import { useState } from 'react'
import { dateLabel, timeLabel } from '@/features/club/model/format'
import { type ClubGame, type Workspace } from '@/features/club/model/types'
import { isAdministrator, managesLineups } from '@/features/club/model/permissions'
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
