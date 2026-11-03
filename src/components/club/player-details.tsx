'use client'
import { useState } from 'react'
import { manilaDate } from '@/lib/club/client'
import { LEVEL_LABEL, GENDER_LABEL, type PlayerProfile } from '@/lib/club/types'
export function PlayerDetails({ prefix = '', required = true, value }: { prefix?: string; required?: boolean; value?: Partial<PlayerProfile> }) {
  const [birthday, setBirthday] = useState(!!value?.birth_date)
  const [age, setAge] = useState(value?.birth_date ? '' : String(value?.age ?? '')), [birthDate, setBirthDate] = useState(value?.birth_date || '')
  return <div className="club-player-details"><div className="club-form-grid"><label>Level<select name={`${prefix}level`} required={required} defaultValue={value?.level || ''}><option value="">Choose level</option>{Object.entries(LEVEL_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Gender<select name={`${prefix}gender`} required={required} defaultValue={value?.gender || ''}><option value="">Choose option</option>{Object.entries(GENDER_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><div className="club-age-field"><label>{birthday ? 'Birthday' : 'Age'}{birthday ? <input key="birthday" type="date" name={`${prefix}birth_date`} required={required} max={manilaDate(new Date())} value={birthDate} onChange={event => setBirthDate(event.target.value)} /> : <input key="age" type="number" name={`${prefix}age`} required={required} min={0} max={120} step={1} value={age} onChange={event => setAge(event.target.value)} />}</label><button type="button" className="club-button quiet" onClick={() => setBirthday(value => !value)}>{birthday ? 'Enter age instead' : 'Use birthday instead'}</button></div></div>
}
export function BalancingNote() { return <p className="club-note club-balancing-note">We use level, age and gender to balance teams for more enjoyable play. Birthday is optional—enter your age instead.</p> }
