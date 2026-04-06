'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { WeekSchedule, WeekInfo } from '@/lib/types'
import { parseLocalDate } from '@/lib/parse'
import { WeekNavigator } from '@/components/week-navigator'
import { DayGroup } from '@/components/day-group'
import { ContactBar } from '@/components/contact-bar'

/**
 * Returns the index of the week that contains today (Asia/Manila), or the
 * most recent past week if today is after all known weeks.
 * Falls back to the last index if no firstDate data is available.
 */
function findCurrentWeekIndex(weeks: WeekInfo[]): number {
  if (weeks.length === 0) return -1

  const now = new Date()
  const todayStr = now.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  })
  const today = parseLocalDate(todayStr)
  if (!today) return weeks.length - 1

  // Pick the week whose firstDate is closest to today (past or future).
  // e.g. if today is Sunday and the next week starts Monday, show next week.
  let bestIndex = weeks.length - 1
  let minDiff = Number.POSITIVE_INFINITY
  for (let i = 0; i < weeks.length; i++) {
    const first = parseLocalDate(weeks[i].firstDate ?? '')
    if (!first) continue
    const diff = Math.abs(first.getTime() - today.getTime())
    if (diff < minDiff) {
      minDiff = diff
      bestIndex = i
    }
  }
  return bestIndex
}

export default function Page() {
  const [weeks, setWeeks] = useState<WeekInfo[]>([])
  const [weekIndex, setWeekIndex] = useState<number>(-1)
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const messengerUrl = process.env.NEXT_PUBLIC_CONTACT_MESSENGER_URL ?? '#'
  const instagramUrl = process.env.NEXT_PUBLIC_CONTACT_INSTAGRAM_URL ?? '#'

  const fetchSchedule = useCallback(async (weekId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/schedule?week=${weekId}`)
      const data: WeekSchedule = await res.json()
      setSchedule(data)
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

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

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (weekIndex < 0 || weeks.length === 0) return
    const interval = setInterval(() => {
      fetchSchedule(weeks[weekIndex].id)
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [weekIndex, weeks, fetchSchedule])

  const selectedWeek = weeks[weekIndex] ?? null

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
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
          <div className="flex items-center justify-center py-16 text-[#64748b] text-sm">
            No games scheduled for this week.
          </div>
        )}

        {!loading && schedule && schedule.days.map(day => (
          <DayGroup
            key={day.date}
            day={day}
            messengerUrl={messengerUrl}
            instagramUrl={instagramUrl}
          />
        ))}
      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-[#334155] py-3 border-t border-[#1e2535] bg-[#13151f]">
        {lastUpdated
          ? `Last updated: ${lastUpdated.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Manila',
            })} · refreshes every 5 min`
          : 'Loading...'}
      </footer>
    </div>
  )
}
