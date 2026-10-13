'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { WeekSchedule, WeekInfo } from '@/lib/types'
import { findCurrentWeekIndex } from '@/lib/parse'
import { WeekNavigator } from '@/components/week-navigator'
import { DayGroup } from '@/components/day-group'
import { ContactBar } from '@/components/contact-bar'
import { usePullToRefresh } from '@/lib/use-pull-to-refresh'
import { createScheduleRequestManager } from '@/lib/schedule-request'
import { startVisiblePolling } from '@/lib/visible-polling'

export default function Page() {
  const [weeks, setWeeks] = useState<WeekInfo[]>([])
  const [weekIndex, setWeekIndex] = useState<number>(-1)
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [clearKey, setClearKey] = useState<string | null>(null)
  const [clearState, setClearState] = useState<'idle' | 'clearing' | 'done' | 'error'>('idle')
  const requestManager = useRef<ReturnType<typeof createScheduleRequestManager> | null>(null)
  const scheduleBusy = useRef(false)
  if (!requestManager.current) requestManager.current = createScheduleRequestManager()

  const messengerUrl = process.env.NEXT_PUBLIC_CONTACT_MESSENGER_URL ?? '#'
  const instagramUrl = process.env.NEXT_PUBLIC_CONTACT_INSTAGRAM_URL ?? '#'

  const fetchSchedule = useCallback(
    async (weekId: string, opts?: { silent?: boolean }) => {
      if (opts?.silent && scheduleBusy.current) return
      scheduleBusy.current = true
      const request = requestManager.current!.start()
      if (!opts?.silent) {
        setLoading(true)
        setScheduleError(null)
      }
      try {
        const res = await fetch(`/api/schedule?week=${encodeURIComponent(weekId)}`, {
          signal: request.signal,
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('Failed to load schedule')
        const data: WeekSchedule = await res.json()
        if (!request.isCurrent()) return
        setSchedule(data)
        setLastUpdated(new Date())
      } catch (error) {
        if ((error as DOMException).name !== 'AbortError' && request.isCurrent() && !opts?.silent) {
          setSchedule(null)
          setScheduleError('Unable to load this schedule. Please try again.')
        }
      } finally {
        if (request.isCurrent()) {
          scheduleBusy.current = false
          if (!opts?.silent) setLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => () => requestManager.current?.abort(), [])

  // Pull-to-refresh: swipe down at the top of the page to refetch the current week.
  const { pullDistance, isRefreshing } = usePullToRefresh(async () => {
    if (weekIndex < 0 || weeks.length === 0) return
    await fetchSchedule(weeks[weekIndex].id, { silent: true })
  })

  // On mount: reveal the secret cache-clear button if the URL carries ?clearKey=
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('clearKey')
    if (key) setClearKey(key)
  }, [])

  const handleClearCache = useCallback(async () => {
    if (!clearKey) return
    setClearState('clearing')
    try {
      const res = await fetch('/api/cache/clear', {
        method: 'POST',
        headers: { 'x-cache-key': clearKey },
      })
      if (!res.ok) throw new Error('clear failed')
      setClearState('done')
      // Re-read weeks + current schedule with the freshly cleared cache
      const weeksRes = await fetch('/api/weeks')
      const data: { weeks: WeekInfo[] } = await weeksRes.json()
      setWeeks(data.weeks)
      if (weekIndex >= 0 && data.weeks[weekIndex]) {
        await fetchSchedule(data.weeks[weekIndex].id, { silent: true })
      }
      setTimeout(() => setClearState('idle'), 2000)
    } catch {
      setClearState('error')
      setTimeout(() => setClearState('idle'), 2000)
    }
  }, [clearKey, weekIndex, fetchSchedule])

  // On mount: load available weeks, default to the week containing today (Manila time)
  useEffect(() => {
    async function loadWeeks() {
      try {
        const res = await fetch('/api/weeks')
        const data: { weeks: WeekInfo[] } = await res.json()
        setWeeks(data.weeks)
        if (data.weeks.length > 0) {
          setWeekIndex(findCurrentWeekIndex(data.weeks))
        } else {
          setLoading(false)
        }
      } catch {
        setLoading(false)
      }
    }
    loadWeeks()
  }, [])

  // Fetch schedule whenever selected week changes
  useEffect(() => {
    if (weekIndex < 0 || weeks.length === 0) return
    fetchSchedule(weeks[weekIndex].id)
  }, [weekIndex, weeks, fetchSchedule])

  // Visible screens poll the shared cache; a registration webhook expires it.
  useEffect(() => {
    if (weekIndex < 0 || weeks.length === 0) return
    return startVisiblePolling(() => fetchSchedule(weeks[weekIndex].id, { silent: true }))
  }, [weekIndex, weeks, fetchSchedule])

  const selectedWeek = weeks[weekIndex] ?? null

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      {/* Pull-to-refresh indicator */}
      <div
        className="fixed left-0 right-0 top-0 z-30 flex justify-center pointer-events-none"
        style={{
          transform: `translateY(${pullDistance - 50}px)`,
          opacity: pullDistance > 10 || isRefreshing ? 1 : 0,
          transition:
            pullDistance === 0 && !isRefreshing
              ? 'transform 200ms ease-out, opacity 200ms ease-out'
              : 'none',
        }}
        aria-hidden="true"
      >
        <div className="mt-3 rounded-full border border-[#1e2535] bg-[#13151f] p-2 shadow-lg">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isRefreshing ? 'animate-spin' : ''}
            style={{
              color: pullDistance >= 80 || isRefreshing ? '#3b82f6' : '#64748b',
              transform: isRefreshing
                ? undefined
                : `rotate(${Math.min((pullDistance / 80) * 180, 180)}deg)`,
              transition: 'color 150ms',
            }}
          >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </div>
      </div>

      {/* Header */}
      <header className="bg-[#13151f] border-b border-[#1e2535] px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Dreamers Volleyball Club"
            width={32}
            height={42}
            className="object-contain"
            priority
          />
          <div>
            <h1 className="text-[17px] font-bold text-[#f1f5f9] leading-tight">
              DVC Fun Games
            </h1>
            <p className="text-[11px] text-[#64748b]">Available positions this week</p>
          </div>
        </div>
        <ContactBar />
      </header>

      {/* Week navigator */}
      {selectedWeek && schedule && (
        <WeekNavigator
          weekNumber={selectedWeek.weekNumber}
          dateRange={schedule.dateRange}
          canPrev={weekIndex > 0}
          canNext={weekIndex < weeks.length - 1}
          onPrev={() => setWeekIndex(i => i - 1)}
          onNext={() => setWeekIndex(i => i + 1)}
        />
      )}

      {/* Content */}
      <main className="flex-1 px-3 pb-6 max-w-120 w-full mx-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 text-[#64748b] text-sm">
            Loading schedule...
          </div>
        )}

        {!loading && (!schedule || schedule.days.length === 0) && (
          scheduleError ? (
            <div className="flex items-center justify-center py-16 text-[#f87171] text-sm text-center">
              {scheduleError}
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-[#64748b] text-sm">
              No games scheduled for this week.
            </div>
          )
        )}

        {!loading && schedule && selectedWeek && schedule.days.map(day => (
          <DayGroup
            key={`${selectedWeek.id}:${day.date}`}
            day={day}
            weekId={selectedWeek.id}
            messengerUrl={messengerUrl}
            instagramUrl={instagramUrl}
          />
        ))}

      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-[#334155] py-3 border-t border-[#1e2535] bg-[#13151f] flex flex-col items-center gap-2">
        <span>
          {lastUpdated
            ? `Last updated: ${lastUpdated.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Manila',
              })} · refreshes every 15 sec`
            : 'Loading...'}
        </span>

        {/* Secret cache-clear button — only rendered when ?clearKey= is in the URL */}
        {clearKey && (
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearState === 'clearing'}
            className="cursor-pointer rounded-md border border-[#1e2535] bg-[#0f1117] px-3 py-1.5 text-[11px] font-medium text-[#94a3b8] transition-colors hover:bg-[#1e2535] hover:text-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {clearState === 'clearing'
              ? 'Clearing cache…'
              : clearState === 'done'
                ? 'Cache cleared ✓'
                : clearState === 'error'
                  ? 'Failed — check key'
                  : 'Clear cache'}
          </button>
        )}
      </footer>
    </div>
  )
}
