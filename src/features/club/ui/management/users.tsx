'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { read, RequestError } from '@/features/club/api/client'
import type { ManagementSkillProfile, ManagementUser, ManagementUsersPage } from '@/features/club/model/management-users'
import { LEVEL_LABEL, type StaffRole } from '@/features/club/model/types'
import { CollectionTable, SearchField } from '../shared/collection'
import { AppliedFilters } from '../shared/applied-filters'
import { CursorPagination } from '../shared/cursor-pagination'
import { SkillLevelEditor } from './skill-level-editor'
import { ErrorNotice, Modal } from '../shared/primitives'
import { RequiredLabel, RequiredNote } from '../shared/required'

const LABEL: Record<StaffRole, string> = {
  player: 'Player', facilitator: 'Facilitator', coordinator: 'Coordinator', admin: 'Administrator', developer: 'Developer',
}

export function UsersTable({ developer, busy, revision, action, onAccessLost, active = true }: {
  active?: boolean
  developer: boolean
  busy: boolean
  revision: number
  action: (name: string, data: unknown) => Promise<boolean | void>
  onAccessLost: () => void
}) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('')
  const [cursor, setCursor] = useState<string[]>([])
  const [loadedScope, setLoadedScope] = useState('')
  const [result, setResult] = useState<ManagementUsersPage | null>(null)
  const [displayedPage, setDisplayedPage] = useState(1)
  const [editing, setEditing] = useState<ManagementUser | 'new' | null>(null)
  const [skillEdit, setSkillEdit] = useState<{ name: string; profile: ManagementSkillProfile } | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [editError, setEditError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const after = cursor.at(-1)
  const requestedPage = cursor.length + 1
  const scope = JSON.stringify([query, role])

  useEffect(() => {
    if (!active) return
    let current = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      setLoadError(null)
      read<ManagementUsersPage>('management-users', { query, role, ...(after ? { cursor: after } : {}) })
        .then(page => { if (current) { setResult(page); setLoadedScope(scope); setDisplayedPage(requestedPage) } })
        .catch(error => {
          if (!current) return
          if (error instanceof RequestError && [401, 403].includes(error.status ?? 0)) {
            setResult(null)
            setEditing(null)
            setSkillEdit(null)
            onAccessLost()
          }
          setLoadError(error)
        })
        .finally(() => { if (current) setLoading(false) })
    }, 200)
    return () => { current = false; window.clearTimeout(timer) }
  }, [active, query, role, after, retry, revision, onAccessLost, requestedPage, scope])

  function open(value: ManagementUser | 'new') {
    setEditError(null)
    setEditing(value)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || busy || staleEditor) return
    const form = new FormData(event.currentTarget)
    const selected = form.get('role')
    const existing = editing === 'new' ? null : editing
    setEditError(null)
    try {
      const success = await action('access.save', {
        ...(existing?.access_id ? { id: existing.access_id } : {}),
        expected_version: existing?.version ?? null,
        email: form.get('email'),
        role: selected === 'player' ? existing?.access_role ?? 'facilitator' : selected,
        enabled: selected !== 'player',
      })
      if (success !== false) setEditing(null)
    } catch (error) {
      setEditError(error)
    }
  }

  const visibleResult = scope === loadedScope ? result : null
  const rows = visibleResult?.rows ?? []
  const nextCursor = visibleResult?.next_cursor
  const unavailable = busy || loading || Boolean(loadError)
  const staleEditor = editError instanceof RequestError && editError.status === 409 && editError.message.startsWith('Access changed.')
  const editableRole = editing && editing !== 'new'
    ? editing.access_enabled ? editing.access_role ?? editing.role : editing.role
    : 'facilitator'
  return <section aria-label="User management" aria-busy={loading}>
    <div className="club-section-heading">
      <h2>Users</h2>
      <button type="button" className="club-button primary" onClick={() => open('new')}>Add email</button>
    </div>
    <p className="club-note">Prepare access by email. The role applies after the matching account verifies its email.</p>
    <AppliedFilters filters={[
      ...(query.trim() ? [{ key: 'query', label: `Search: ${query.trim()}`, remove: () => { setLoading(true); setQuery(''); setCursor([]) } }] : []),
      ...(role ? [{ key: 'role', label: `Role: ${LABEL[role as StaffRole]}`, remove: () => { setLoading(true); setRole(''); setCursor([]) } }] : []),
    ]}>
      <div className="club-filter-fields">
      <SearchField label="Search users" placeholder="Search name or email" value={query} change={value => {
        setLoading(true); setQuery(value.slice(0, 120)); setCursor([])
      }} />
      <select aria-label="User role" value={role} onChange={event => {
        setLoading(true); setRole(event.target.value); setCursor([])
      }}>
        <option value="">All roles</option>
        {Object.entries(LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      </div>
    </AppliedFilters>
    <ErrorNotice error={loadError} />
    {Boolean(loadError) && visibleResult && <p className="club-note">Showing the last loaded results.</p>}
    {Boolean(loadError) && <button type="button" className="club-button" onClick={() => setRetry(value => value + 1)}>Retry users</button>}
    <CollectionTable label="Users and prepared roles" headings={['User', 'Role', 'Account', 'Skill level', 'Actions']} count={rows.length}
      footer={<CursorPagination label="Users pages" pageNumber={displayedPage} pageSize={25} rowCount={rows.length}
        loading={loading} previous={cursor.length ? () => {
          setLoading(true); setCursor(stack => stack.slice(0, -1))
        } : undefined} next={nextCursor && !loadError ? () => {
          setLoading(true); setCursor(stack => [...stack, nextCursor])
        } : undefined} />}
      empty={loading ? 'Loading users…' : loadError ? 'Users could not be loaded.' : 'No users match these filters.'}>
      {rows.map(user => {
        const profile = user.registered ? user.skill_profile : null
        const label = user.name || user.email
        return <tr key={user.email}>
        <td data-label="User"><span className="club-cell-stack"><strong>{user.name || user.email}</strong>{user.name && <small>{user.email}</small>}</span></td>
        <td data-label="Role">{LABEL[user.role]}{user.access_enabled && user.access_role && user.access_role !== user.role && <small> · {LABEL[user.access_role]} prepared</small>}</td>
        <td data-label="Account">{user.registered ? user.verified ? 'Registered' : 'Email unverified' : 'Pending sign-in'}</td>
        <td data-label="Skill level">{profile ? LEVEL_LABEL[profile.level] : 'No player profile'}</td>
        <td data-label="Actions"><div className="club-row-actions">
          <button type="button" className="club-button" disabled={unavailable || (!developer && user.access_role === 'developer')}
            onClick={() => open(user)}>Edit role<span className="club-sr-only"> for {label}</span></button>
          {profile && <button type="button" className="club-button" disabled={unavailable}
            onClick={() => setSkillEdit({ name: label, profile })}>
            Edit skill level<span className="club-sr-only"> for {label}</span>
          </button>}
        </div></td>
      </tr>})}
    </CollectionTable>
    {skillEdit && <SkillLevelEditor name={skillEdit.name} profile={skillEdit.profile} busy={busy}
      save={data => action('profile.skill.save', data)} close={() => setSkillEdit(null)}
      refresh={() => { setSkillEdit(null); setRetry(value => value + 1) }} />}
    {editing && <Modal title={editing === 'new' ? 'Prepare user access' : 'Edit user role'} close={() => setEditing(null)} dismissible={!busy}>
      <ErrorNotice error={editError} />
      {staleEditor && <button type="button" className="club-button" onClick={() => {
        setEditing(null)
        setRetry(value => value + 1)
      }}>Close and refresh Users</button>}
      <form className="club-form" onSubmit={save}>
        <RequiredNote />
        {editing === 'new' ? <label><RequiredLabel>Email</RequiredLabel><input type="email" name="email" required maxLength={254} /></label>
          : <label>Email<output className="club-role-identity">{editing.email}</output><input type="hidden" name="email" value={editing.email} /></label>}
        <label><RequiredLabel>Role</RequiredLabel><select name="role" required defaultValue={editableRole}>
          {Object.entries(LABEL).filter(([value]) => (value !== 'developer' || developer) && (editing !== 'new' || value !== 'player'))
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <p className="club-note">{editing === 'new'
          ? 'The role applies once the matching email is verified.'
          : 'Choose Player to remove staff access. Only a Developer can change Developer access.'}</p>
        <button type="submit" className="club-button primary" disabled={busy || staleEditor}>{busy ? 'Saving…' : 'Save role'}</button>
      </form>
    </Modal>}
  </section>
}
