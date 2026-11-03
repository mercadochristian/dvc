'use client'
import { useState } from 'react'
import { teammateSlots } from '@/lib/club/lineup'
import { POSITION_LABEL, type ClubPosition } from '@/lib/club/types'
import { PlayerDetails } from './player-details'
function Teammate({ position, field, index }: { position: ClubPosition; field: string; index: number }) {
  const [name, setName] = useState('')
  return <fieldset className="club-teammate"><legend>{POSITION_LABEL[position]} · Player {index + 1}</legend><label>Name<input name={field} maxLength={100} placeholder="Player to be named" value={name} onChange={event => setName(event.target.value)} /></label>{name.trim() && <PlayerDetails prefix={`${field}-`} />}</fieldset>
}
export function TeammateFields({ position }: { position: ClubPosition }) {
  return <details className="club-teammates"><summary>Add teammates <span>(optional)</span></summary><div className="club-form">{teammateSlots(position).map((slot, index) => <Teammate key={slot.key} position={slot.position} field={slot.key} index={index} />)}</div></details>
}
