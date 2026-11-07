'use client'

import { useRef, useState, type FormEvent } from 'react'
import { RequestError } from '@/features/club/api/client'
import type { ManagementSkillProfile } from '@/features/club/model/management-users'
import { LEVEL_LABEL } from '@/features/club/model/types'
import { ErrorNotice, Modal } from '../shared/primitives'
import { RequiredLabel } from '../shared/required'

export function SkillLevelEditor({ name, profile, busy, save, close, refresh }: {
  name: string
  profile: ManagementSkillProfile
  busy: boolean
  save: (data: unknown) => Promise<boolean | void>
  close: () => void
  refresh: () => void
}) {
  const [level, setLevel] = useState<string>(profile.level)
  const [error, setError] = useState<unknown>(null)
  const submitting = useRef(false)
  const stale = error instanceof RequestError && error.status === 409
    && error.message.startsWith('Player profile changed.')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || submitting.current || stale || level === profile.level) return
    submitting.current = true
    setError(null)
    try {
      if (await save({ user_id: profile.user_id, level, expected_version: profile.version }) !== false) close()
    } catch (failure) {
      setError(failure)
    } finally {
      submitting.current = false
    }
  }

  return <Modal title="Edit skill level" close={close} dismissible={!busy}>
    <p><strong>{name}</strong></p>
    <ErrorNotice error={error} />
    {stale && <button type="button" className="club-button" onClick={refresh}>Close and refresh Users</button>}
    <form className="club-form" onSubmit={submit}>
      <label>
        <RequiredLabel>Skill level</RequiredLabel>
        <select value={level} required disabled={busy || stale} onChange={event => setLevel(event.target.value)}>
          {Object.entries(LEVEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="club-note">This level applies to future registrations for this account. Existing registrations and lineups keep their recorded level.</p>
      <button type="submit" className="club-button primary" disabled={busy || stale || level === profile.level}>
        {busy ? 'Saving…' : 'Save skill level'}
      </button>
    </form>
  </Modal>
}
