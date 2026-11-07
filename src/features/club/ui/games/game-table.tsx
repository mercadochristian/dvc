'use client'
import { dateLabel, money, timeLabel } from '@/features/club/model/format'
import { POSITIONS, POSITION_LABEL, type ClubGame } from '@/features/club/model/types'
import { CollectionTable, RecordStatus } from '../shared/collection'
import { gameDisplayState } from '@/features/club/model/game-display'
import { Price } from './game-card'
import type { ReactNode } from 'react'
import { VenueLink } from '../shared/venue-link'
export function GameTable({games,register,players,details,selection,now = Date.now()}:{games:ClubGame[];register:(game:ClubGame)=>void;players:(game:ClubGame)=>void;details?:(game:ClubGame)=>void;selection?:(game:ClubGame)=>ReactNode;now?:number}) {
  return <CollectionTable label="Available games" headings={['Game',...POSITIONS.map(p=>POSITION_LABEL[p]),'Team price','Actions']} count={games.length} className="club-schedule-table" empty="No games match these filters.">{games.map(game=>{
    const state=gameDisplayState(game,now)
    return <tr key={game.id}><td data-label="Game"><span className="club-cell-stack"><strong><VenueLink name={game.venue} mapsUrl={game.maps_url}/></strong><small>{game.city} · {dateLabel(game.starts_at)}</small><small>{timeLabel(game.starts_at)}–{timeLabel(game.ends_at)}</small><RecordStatus value={state.label.toLowerCase()} label={state.registerable?`${state.total} slots left`:state.label}/>{!!game.facilitators?.length&&<small>Facilitator · {game.facilitators.map(f=>f.name).join(', ')}</small>}</span></td>{POSITIONS.map(position=>{const p=game.positions.find(p=>p.position===position);return <td key={position} data-label={POSITION_LABEL[position]}><span className="club-cell-stack club-numeric"><strong>{state.showAvailability?p?.available?`${p.available} left`:'Full':null}</strong><small><Price amount={p?.price||0} regular={p?.regular_price}/> / player</small></span></td>})}<td data-label="Team price"><span className="club-cell-stack club-numeric"><strong><Price amount={game.team_price} regular={game.regular_team_price}/></strong><small>Total</small></span></td><td data-label="Actions"><div className="club-row-actions club-schedule-actions">{!selection && <button className="club-button primary" disabled={!state.registerable} onClick={()=>register(game)}>{state.button}</button>}<button className="club-button" onClick={()=>players(game)}>Players</button>{details&&<button className="club-button" onClick={()=>details(game)}>Details</button>}{selection?.(game)}</div></td></tr>
  })}</CollectionTable>
}
