'use client'
import { useState } from 'react'
import { teammateSlots } from '@/features/club/model/lineup'
import { POSITION_LABEL, type ClubPosition } from '@/features/club/model/types'
import { PlayerDetails } from './player-details'

function Teammate({ position, field, index, gameDate }: { position: ClubPosition; field: string; index: number; gameDate?: string }) {
  const [name, setName] = useState('')
  return <fieldset className="club-teammate"><legend>{POSITION_LABEL[position]} · Player {index + 1}</legend>
    <label>Name (optional)<input name={field} maxLength={100} placeholder="Player to be named" value={name} onChange={event => setName(event.target.value)} /></label>
    {name.trim() && <><PlayerDetails prefix={`${field}-`} gameDate={gameDate} /><label>Email (optional)<input name={`${field}-email`} type="email" maxLength={254} autoComplete="off" /><small>Receive this booking's schedule confirmation.</small></label></>}
  </fieldset>
}
export function TeammateFields({ position, gameDate }: { position: ClubPosition | null; gameDate?: string }) {
  return <details className="club-teammates"><summary>Add players <span>(names optional)</span></summary><div className="club-form">{teammateSlots(position).map((slot, index) => <Teammate key={slot.key} position={slot.position} field={slot.key} index={index} gameDate={gameDate} />)}</div></details>
}
