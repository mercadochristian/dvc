'use client'

import { useEffect, useRef } from 'react'
import type { RegisteredPlayersResponse } from '@/lib/registered-players'

interface Props {
  open: boolean
  titleId: string
  date: string
  location: string
  time: string
  loading: boolean
  error: boolean
  data: RegisteredPlayersResponse | null
  onClose: () => void
  onRetry: () => void
}

export function RegisteredPlayersDialog({
  open, titleId, date, location, time, loading, error, data, onClose, onRetry,
}: Readonly<Props>) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const hasPlayers = data?.groups.some(group => group.players.length > 0) ?? false
  const updatedAt = data
    ? new Date(data.fetchedAt).toLocaleTimeString('en-PH', {
        hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
      })
    : null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={onClose}
      onClick={event => {
        event.stopPropagation()
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
      onKeyDown={event => event.stopPropagation()}
      className="m-auto w-[min(92vw,520px)] max-h-[85dvh] overflow-y-auto rounded-[16px] border border-[#252840] bg-[#13151f] p-0 text-[#f1f5f9] shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop:bg-black/75"
    >
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-[#252840] bg-[#13151f] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[17px] font-bold leading-tight">
            Registered Players
          </h2>
          <p className="mt-1 text-[12px] text-[#94a3b8]">
            {date} · {location} · {time}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close registered players"
          className="-mr-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#94a3b8] hover:bg-[#252840] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 5l14 14M19 5 5 19" />
          </svg>
        </button>
      </div>

      <div className="px-5 py-5" aria-live="polite">
        {loading && (
          <div className="flex items-center gap-3 py-8 text-[13px] text-[#94a3b8]" role="status">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" aria-hidden="true" />
            Loading registered players...
          </div>
        )}

        {!loading && error && (
          <div className="py-5 text-center">
            <p className="text-[13px] text-[#f1f5f9]">Unable to load registered players.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 cursor-pointer rounded-lg bg-[#3b82f6] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#2563eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && data && !hasPlayers && (
          <p className="py-8 text-center text-[13px] text-[#94a3b8]">
            No registered players yet.
          </p>
        )}

        {!loading && !error && data && hasPlayers && (
          <div className="space-y-5">
            {data.groups.map(group => (
              <section key={group.position} aria-label={group.position}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-bold text-[#f1f5f9]">{group.position}</h3>
                  <span className="rounded-full bg-[#252840] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#94a3b8]">
                    {group.players.reduce((total, player) => total + player.count, 0)}
                  </span>
                </div>
                {group.players.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {group.players.map((player, index) => (
                      <li key={`${player.firstName}-${index}`} className="rounded-lg bg-[#1a1d2e] px-2.5 py-1.5 text-[13px] text-[#e2e8f0]">
                        {player.count > 1
                          ? `${player.firstName}'s Team (${player.count})`
                          : player.firstName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-[#94a3b8]">None yet</p>
                )}
              </section>
            ))}
          </div>
        )}

        {!loading && !error && data && updatedAt && (
          <p className="mt-6 border-t border-[#252840] pt-3 text-[11px] text-[#94a3b8]">
            Updated at {updatedAt} · Names may change as players register.
          </p>
        )}
      </div>
    </dialog>
  )
}
