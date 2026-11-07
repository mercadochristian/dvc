'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { read } from '@/features/club/api/client'
import { CursorPagination } from '../shared/cursor-pagination'
import { useCollectionPage, useCursorPaging } from '../shared/use-collection-page'
import { AppliedFilters } from '../shared/applied-filters'
import { CollectionTable, RecordStatus, SearchField } from '../shared/collection'
import type { Announcement } from '@/features/club/model/types'
import { ErrorNotice, Modal } from '../shared/primitives'
import { RequiredLabel, RequiredNote } from '../shared/required'

type Action = (name: string, data: unknown) => Promise<boolean | void>
const manilaTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
})

function localDateTime(value: string | null | undefined) {
  return value ? new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''
}

function AnnouncementBanner({ item, dismiss }: { item: Announcement; dismiss: () => void }) {
  return <aside className="club-announcement" aria-label={`Announcement: ${item.title}`}>
    <div><strong>{item.title}</strong><p>{item.body}</p></div>
    <button type="button" className="club-button quiet club-icon-button" aria-label={`Dismiss ${item.title}`} onClick={dismiss}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  </aside>
}

export function AnnouncementBanners() {
  const [items, setItems] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [now, setNow] = useState(Date.now)

  const [mobile, setMobile] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const slide = useRef<HTMLDivElement>(null)
  const pendingMotion = useRef<{ id: string; direction: -1 | 1 } | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const sync = () => setMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    let active = true
    let pending = false
    let expiry: ReturnType<typeof setTimeout> | undefined

    async function refresh() {
      if (document.hidden || pending) return
      setNow(Date.now())
      pending = true
      try {
        const announcements = await read<Announcement[]>('announcements')
        if (!active) return
        setItems(announcements)
        const time = Date.now()
        clearTimeout(expiry)
        const nextEnd = Math.min(...announcements.map(item => item.ends_at ? Date.parse(item.ends_at) : Infinity).filter(end => end > time))
        if (nextEnd - time < 30_000) expiry = setTimeout(() => setNow(Date.now()), nextEnd - time)
        setDismissed(previous => [...new Set([...previous, ...announcements.filter(item => {
          try { return localStorage.getItem(`dvc-announcement:${item.id}`) === item.updated_at }
          catch { return false }
        }).map(item => `${item.id}:${item.updated_at}`)])])
      } catch {
        // Keep the last successful list. Scheduled banners still expire locally.
      } finally {
        pending = false
      }
    }

    void refresh()
    const timer = setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      clearInterval(timer)
      clearTimeout(expiry)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  function dismiss(item: Announcement) {
    setDismissed(previous => [...previous, `${item.id}:${item.updated_at}`])
    try { localStorage.setItem(`dvc-announcement:${item.id}`, item.updated_at) }
    catch { /* Dismissal still works for this page. */ }
  }

  const visible = items.filter(item => (!item.ends_at || Date.parse(item.ends_at) > now) &&
    !dismissed.includes(`${item.id}:${item.updated_at}`))
  const index = Math.max(0, visible.findIndex(item => item.id === selectedId))
  const selected = visible[index]

  const activeId = selected?.id
  useLayoutEffect(() => {
    const request = pendingMotion.current
    pendingMotion.current = null
    const element = slide.current
    if (!mobile || !element || !request || request.id !== activeId) return

    const style = getComputedStyle(element)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frames = reduce
      ? [{ opacity: 0.85 }, { opacity: 1 }]
      : [{ transform: `translateX(${request.direction * 12}px)`, opacity: 0.85 },
         { transform: 'translateX(0)', opacity: 1 }]
    const animation = element.animate(frames, {
      duration: Number.parseFloat(style.getPropertyValue('--dvc-motion-feedback')),
      easing: style.getPropertyValue('--dvc-motion-ease').trim(),
    })
    return () => animation.cancel()
  }, [activeId, mobile])

  function move(step: -1 | 1, animate = true) {
    const target = visible[index + step]
    if (!target) return
    pendingMotion.current = animate ? { id: target.id, direction: step } : null
    setSelectedId(target.id)
  }

  if (!selected) return null
  if (!mobile) return <div className="club-announcements">
    {visible.map(item => <AnnouncementBanner key={item.id} item={item} dismiss={() => dismiss(item)} />)}
  </div>

  return <div className="club-announcements">
    <div className="club-announcement-swipe"
      onTouchStart={event => {
        const touch = event.touches[0]
        touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null
      }}
      onTouchCancel={() => { touchStart.current = null }}
      onTouchEnd={event => {
        const start = touchStart.current
        touchStart.current = null
        const touch = event.changedTouches[0]
        if (!start || !touch || event.touches.length) return
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1)
      }}>
      <div ref={slide}>
        <AnnouncementBanner item={selected} dismiss={() => {
          setSelectedId((visible[index + 1] ?? visible[index - 1])?.id ?? null)
          dismiss(selected)
        }} />
      </div>
    </div>
    {visible.length > 1 && <nav className="club-announcement-navigation" aria-label="Announcements">
      <button type="button" className="club-button quiet club-icon-button" aria-label="Previous announcement"
        aria-disabled={index === 0} onClick={event => move(-1, event.detail > 0)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 3-5 5 5 5" /></svg>
      </button>
      <span className="club-note" role="status">{index + 1} of {visible.length}</span>
      <button type="button" className="club-button quiet club-icon-button" aria-label="Next announcement"
        aria-disabled={index === visible.length - 1} onClick={event => move(1, event.detail > 0)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
      </button>
    </nav>}
  </div>
}

function announcementStatus(item: Announcement, now: number) {
  if (!item.enabled) return 'Unpublished'
  if (!item.publish_at || !item.ends_at) return 'Published'
  if (now < Date.parse(item.publish_at)) return 'Scheduled'
  return now < Date.parse(item.ends_at) ? 'Published' : 'Ended'
}

const ANNOUNCEMENT_PAGE_SIZE = 25

export function AnnouncementManager({ userId, active, revision, onAccessLost, busy, action, error }: {
  userId: string; active: boolean; revision: number; onAccessLost: () => void
  busy: boolean; action: Action; error?: unknown
}) {
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null)
  const [scheduleChange, setScheduleChange] = useState<Announcement | null>(null)
  const [scheduleError, setScheduleError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const original = editing === 'new' ? null : editing
  const now = Date.now()
  const paging = useCursorPaging()
  const params = new URLSearchParams({ query: query.trim(), status,
    ...(paging.after ? { after: paging.after } : {}) }).toString()
  const { page, loading, error: pageError, retry, displayedPageNumber } = useCollectionPage<Announcement>(
    'management-announcements', ANNOUNCEMENT_PAGE_SIZE, userId, params, revision, onAccessLost, active, paging.pageNumber,
  )
  const rows = page?.rows ?? []
  const nextCursor = page?.next_cursor

  function changeQuery(value: string) {
    setQuery(value.slice(0, 120))
    paging.reset()
  }

  function changeStatus(value: string) {
    setStatus(value)
    paging.reset()
  }

  function edit(item: Announcement | 'new') {
    setScheduleError('')
    setEditing(item)
  }

  return <>
    <div className="club-section-heading">
      <h2>Announcements</h2>
      <button className="club-button primary" onClick={() => edit('new')}>New announcement</button>
    </div>
    <p className="club-note">Enabled announcements appear as dismissible banners during their scheduled window. Schedule times are shown in Manila time.</p>
    <AppliedFilters filters={[
      ...(query.trim() ? [{ key: 'query', label: `Search: ${query.trim()}`, remove: () => changeQuery('') }] : []),
      ...(status ? [{ key: 'status', label: status, remove: () => changeStatus('') }] : []),
    ]}>
      <div className="club-filter-fields">
        <SearchField label="Search announcements" placeholder="Search title or message" value={query} change={changeQuery} />
        <select aria-label="Announcement status" value={status} onChange={event => changeStatus(event.target.value)}>
          <option value="">All statuses</option>
          {['Scheduled', 'Published', 'Ended', 'Unpublished'].map(state => <option key={state}>{state}</option>)}
        </select>
      </div>
    </AppliedFilters>
    <ErrorNotice error={pageError} />
    {Boolean(pageError) && <button type="button" className="club-button" onClick={retry}>Retry announcements</button>}
    <CollectionTable label="Announcements" headings={['Announcement', 'Publish at', 'End at', 'Status', 'Actions']}
      count={rows.length} empty={loading ? 'Loading announcements…' : query.trim() || status ? 'No announcements match these filters.' : 'No announcements yet.'}
      footer={<CursorPagination label="Announcement pages" pageNumber={displayedPageNumber}
        pageSize={ANNOUNCEMENT_PAGE_SIZE} rowCount={rows.length} loading={loading}
        previous={pageError ? undefined : paging.previous}
        next={nextCursor && !pageError ? () => paging.next(nextCursor) : undefined} />}>
      {rows.map(item => <tr key={item.id}>
        <td data-label="Announcement"><strong>{item.title}</strong><p className="club-announcement-text">{item.body}</p></td>
        <td data-label="Publish at">{item.publish_at ? manilaTime.format(new Date(item.publish_at)) : '—'}</td>
        <td data-label="End at">{item.ends_at ? manilaTime.format(new Date(item.ends_at)) : '—'}</td>
        <td data-label="Status"><RecordStatus value={announcementStatus(item, now).toLowerCase()} /></td>
        <td data-label="Actions"><div className="club-row-actions">
          <button type="button" className="club-button quiet" aria-label={`Edit ${item.title}`} onClick={() => edit(item)}>Edit</button>
          <button type="button" className="club-button quiet" disabled={busy}
            aria-label={`${!item.publish_at || !item.ends_at ? 'Set schedule for' : item.enabled ? 'Unpublish' : 'Enable schedule for'} ${item.title}`}
            onClick={() => {
            if (!item.publish_at || !item.ends_at) { edit(item); return }
            setScheduleChange(item)
          }}>{!item.publish_at || !item.ends_at ? 'Set schedule' : item.enabled ? 'Unpublish' : 'Enable schedule'}</button>
        </div></td>
      </tr>)}
    </CollectionTable>
    {scheduleChange && <Modal title={scheduleChange.enabled ? 'Unpublish announcement?' : 'Enable announcement schedule?'}
      close={() => setScheduleChange(null)} dismissible={!busy}>
      <p><strong>{scheduleChange.title}</strong></p>
      <p>{scheduleChange.enabled
        ? 'The banner will stop appearing. You can re-enable its saved schedule later.'
        : 'The banner can appear during its saved publication window.'}</p>
      <ErrorNotice error={error} />
      <div className="club-actions">
        <button type="button" className="club-button" disabled={busy} onClick={() => setScheduleChange(null)}>Keep current status</button>
        <button type="button" className={`club-button ${scheduleChange.enabled ? 'danger' : 'primary'}`} disabled={busy} onClick={async () => {
          if (!scheduleChange.publish_at || !scheduleChange.ends_at) return
          const saved = await action('announcement.save', {
            ...scheduleChange, enabled: !scheduleChange.enabled,
            publish_at: new Date(scheduleChange.publish_at).toISOString(),
            ends_at: new Date(scheduleChange.ends_at).toISOString(),
          })
          if (saved !== false) setScheduleChange(null)
        }}>{scheduleChange.enabled ? 'Unpublish' : 'Enable schedule'}</button>
      </div>
    </Modal>}
    {editing && <Modal title={original ? 'Edit announcement' : 'New announcement'} close={() => setEditing(null)} dismissible={!busy}>
      <ErrorNotice error={error} />
      <form className="club-form" onSubmit={event => {
        event.preventDefault()
        if (busy) return
        const form = new FormData(event.currentTarget)
        const publish = new Date(`${form.get('publish_at')}+08:00`)
        const end = new Date(`${form.get('ends_at')}+08:00`)
        if (!Number.isFinite(+publish) || !Number.isFinite(+end) || end <= publish) {
          setScheduleError('Enter a publish time and a later end time.')
          return
        }
        setScheduleError('')
        void action('announcement.save', {
          ...(original ? { id: original.id } : {}), title: form.get('title'), body: form.get('body'),
          enabled: form.get('enabled') === 'on', publish_at: publish.toISOString(), ends_at: end.toISOString(),
        }).then(ok => { if (ok !== false) setEditing(null) })
      }}>
        <RequiredNote />
        <label><RequiredLabel>Title</RequiredLabel><input name="title" required maxLength={120} defaultValue={original?.title} /></label>
        <label><RequiredLabel>Announcement</RequiredLabel><textarea name="body" required maxLength={1500} rows={5} defaultValue={original?.body} /></label>
        <div className="club-form-grid">
          <label><RequiredLabel>Publish at · Manila time</RequiredLabel><input type="datetime-local" name="publish_at" required defaultValue={localDateTime(original?.publish_at)} /></label>
          <label><RequiredLabel>End at · Manila time</RequiredLabel><input type="datetime-local" name="ends_at" required defaultValue={localDateTime(original?.ends_at)} /></label>
        </div>
        {scheduleError && <p role="alert">{scheduleError}</p>}
        <label className="club-check"><input type="checkbox" name="enabled" defaultChecked={original?.enabled ?? true} /> Enable scheduled publication</label>
        <button className="club-button primary" disabled={busy}>Save announcement</button>
      </form>
    </Modal>}
  </>
}
