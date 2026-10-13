// src/components/game-card.tsx
'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Game } from '@/lib/types'
import type { RegisteredPlayersResponse } from '@/lib/registered-players'
import { computeAvailableTeams } from '@/lib/parse'
import { StatusBadge } from './status-badge'
import { PositionSlot } from './position-slot'
import { RegisteredPlayersDialog } from './registered-players-dialog'
import { startVisiblePolling } from '@/lib/visible-polling'

const MessengerIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white shrink-0">
    <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.84 1.275 5.381 3.306 7.165v3.576l3.285-1.8c.877.24 1.808.37 2.768.37 5.523 0 10-4.144 10-9.259C22 6.146 17.523 2 12 2zm1.07 12.483-2.549-2.67-4.976 2.67 5.474-5.804 2.612 2.67 4.913-2.67-5.474 5.804z" />
  </svg>
)

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white shrink-0">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
)

function ChevronIcon({ expanded }: Readonly<{ expanded: boolean }>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-[#64748b] transition-transform duration-200 ${
        expanded ? 'rotate-180' : ''
      }`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

interface GameCardProps {
  game: Game
  weekId: string
  messengerUrl: string
  instagramUrl: string
}

export function GameCard({
  game,
  weekId,
  messengerUrl,
  instagramUrl,
}: Readonly<GameCardProps>) {
  const { location, city, time, cancelled, status, positions } = game
  const availableTeams = computeAvailableTeams(positions)
  const isDone = status === 'done'
  const isCollapsible = cancelled || isDone
  const [expanded, setExpanded] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState(false)
  const [rosterData, setRosterData] = useState<RegisteredPlayersResponse | null>(null)
  const rosterRequest = useRef<AbortController | null>(null)
  const rosterTrigger = useRef<HTMLButtonElement | null>(null)
  const showDetails = !isCollapsible || expanded

  useEffect(() => () => rosterRequest.current?.abort(), [])

  const loadRoster = useCallback(async (background = false) => {
    if (background && rosterRequest.current) return
    rosterRequest.current?.abort()
    const controller = new AbortController()
    rosterRequest.current = controller
    if (!background) {
      setRosterLoading(true)
      setRosterError(false)
      setRosterData(null)
    }

    const query = new URLSearchParams({
      week: weekId, date: game.date, location, time,
    })
    try {
      const response = await fetch(`/api/registered-players?${query}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Roster request failed')
      const data: RegisteredPlayersResponse = await response.json()
      if (!controller.signal.aborted) {
        setRosterData(data)
        setRosterError(false)
      }
    } catch {
      if (!controller.signal.aborted && !background) setRosterError(true)
    } finally {
      if (rosterRequest.current === controller) {
        rosterRequest.current = null
        if (!controller.signal.aborted) setRosterLoading(false)
      }
    }
  }, [weekId, game.date, location, time])

  useEffect(() => {
    if (!rosterOpen) return
    return startVisiblePolling(() => loadRoster(true))
  }, [rosterOpen, loadRoster])

  const openRoster = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    rosterTrigger.current = event.currentTarget
    setRosterOpen(true)
    // Always consult the shared server cache on opening: a submission may have
    // invalidated it since this browser last opened the modal.
    void loadRoster()
  }

  const closeRoster = () => {
    rosterRequest.current?.abort()
    setRosterOpen(false)
    rosterTrigger.current?.focus()
  }

  const toggle = () => setExpanded((v) => !v)
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  const collapsibleProps = isCollapsible
    ? {
        onClick: toggle,
        onKeyDown: handleKeyDown,
        tabIndex: 0,
        role: 'button' as const,
        'aria-expanded': expanded,
      }
    : {}

  let opacityClass = ''
  if (cancelled) opacityClass = 'opacity-45'
  else if (isDone) opacityClass = 'opacity-60'

  return (
    <div
      className={`bg-[#1a1d2e] border border-[#252840] rounded-[14px] p-3.5 mb-2.5 ${opacityClass} ${
        isCollapsible ? 'cursor-pointer select-none' : ''
      }`}
      {...collapsibleProps}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-1">
        <span
          className={`text-[15px] font-bold ${
            cancelled ? 'line-through text-[#94a3b8]' : 'text-[#f1f5f9]'
          }`}
        >
          {location}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 ml-2 mt-0.5">
          <StatusBadge status={status} />
          {isCollapsible && <ChevronIcon expanded={expanded} />}
        </div>
      </div>

      {/* Meta */}
      <p className={`text-[12px] text-[#64748b] ${showDetails ? 'mb-3' : ''}`}>
        {time} · {city}
      </p>

      {showDetails && (
        <>
          {/* Position grid */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {positions.map((pos) => (
              <PositionSlot key={pos.name} position={pos} />
            ))}
          </div>

          <button
            type="button"
            onClick={openRoster}
            className="mb-3 w-full cursor-pointer rounded-[10px] border border-[#3b82f6]/40 bg-[#3b82f6]/10 px-3 py-2.5 text-center text-[12px] font-semibold text-[#93c5fd] transition-colors hover:border-[#3b82f6] hover:bg-[#3b82f6]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6]"
          >
            View Registered Players
          </button>

          {/* Team registration availability */}
          <div
            className={`rounded-[10px] p-2.5 text-center border mb-3 ${
              availableTeams > 0
                ? 'bg-[#0f1117] border-[#252840]'
                : 'bg-[#1c0a0a] border-[#7f1d1d]'
            }`}
          >
            <div className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1">
              Team Registration
            </div>
            {availableTeams > 0 ? (
              <div
                className={`text-[22px] font-extrabold leading-none ${
                  availableTeams <= 2 ? 'text-[#fb923c]' : 'text-[#4ade80]'
                }`}
              >
                {availableTeams}
              </div>
            ) : (
              <div className="text-sm font-bold text-[#f87171]">Full</div>
            )}
          </div>

          {/* Availability disclaimer — shown only for active games */}
          {!isCollapsible && (
            <p className="text-[10px] text-[#475569] text-center mb-2.5 leading-relaxed">
              Availability shown may not be up to date. Please confirm with the admin before signing up.
            </p>
          )}

          {/* Inquiry row — hidden for cancelled and done games */}
          {!isCollapsible && (
            <div className="flex items-center gap-2 pt-2.5 border-t border-[#252840]">
              <span className="text-[11px] text-[#64748b] flex-1">
                Interested? Contact admin
              </span>
              <a
                href={messengerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 px-2.5 rounded-full bg-[#0084ff] flex items-center gap-1.5 text-[11px] font-semibold text-white"
              >
                <MessengerIcon />
                Messenger
              </a>
              <a
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-semibold text-white"
                style={{
                  background:
                    'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
                }}
              >
                <InstagramIcon />
                Instagram
              </a>
            </div>
          )}
        </>
      )}
      <RegisteredPlayersDialog
        open={rosterOpen}
        titleId={`registered-players-${game.id}`}
        date={game.date}
        location={location}
        time={time}
        loading={rosterLoading}
        error={rosterError}
        data={rosterData}
        onClose={closeRoster}
        onRetry={() => void loadRoster()}
      />
    </div>
  )
}
