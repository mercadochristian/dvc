'use client'
import { dateLabel, money, timeLabel } from '@/lib/club/client'
import { POSITIONS, POSITION_LABEL, type ClubGame } from '@/lib/club/types'
import { CollectionTable, RecordStatus } from './collection'
import { VenueLink } from './venue-link'
export function GameTable({games,register,players}:{games:ClubGame[];register:(game:ClubGame)=>void;players:(game:ClubGame)=>void}) {
  return <CollectionTable label="Available games" headings={['Game',...POSITIONS.map(p=>POSITION_LABEL[p]),'Team of 6','Actions']} count={games.length} className="club-schedule-table" empty="No games match these filters.">{games.map(game=>{
    const total=game.positions.reduce((sum,p)=>sum+p.available,0),closed=game.status!=='published'||Date.parse(game.starts_at)<=Date.now()
    return <tr key={game.id}><td data-label="Game"><span className="club-cell-stack"><strong><VenueLink name={game.venue} mapsUrl={game.maps_url}/></strong><small>{game.city} · {dateLabel(game.starts_at)}</small><small>{timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</small><RecordStatus value={game.status==='cancelled'?'cancelled':closed?'closed':total?'published':'full'} label={game.status==='cancelled'?'Cancelled':closed?'Closed':total?`${total} slots left`:'Full'}/>{!!game.facilitators?.length&&<small>Faci · {game.facilitators.map(f=>f.name).join(', ')}</small>}</span></td>{POSITIONS.map(position=>{const p=game.positions.find(p=>p.position===position);return <td key={position} data-label={POSITION_LABEL[position]}><span className="club-cell-stack club-numeric"><strong>{p?.available?`${p.available} left`:'Full'}</strong><small>{money(p?.price||0)} / player</small></span></td>})}<td data-label="Team of 6"><span className="club-cell-stack club-numeric"><strong>{money(game.team_price)}</strong><small>Total</small></span></td><td data-label="Actions"><div className="club-row-actions club-schedule-actions"><button className="club-button primary" disabled={closed||!total} onClick={()=>register(game)}>{closed?'Closed':total?'Register':'Full'}</button><button className="club-button" onClick={()=>players(game)}>Players</button></div></td></tr>
  })}</CollectionTable>
}
