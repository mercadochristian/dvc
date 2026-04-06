// src/components/game-card.tsx
import { Game } from '@/lib/types'
import { StatusBadge } from './status-badge'
import { PositionSlot } from './position-slot'

const MessengerIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white flex-shrink-0">
    <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.84 1.275 5.381 3.306 7.165v3.576l3.285-1.8c.877.24 1.808.37 2.768.37 5.523 0 10-4.144 10-9.259C22 6.146 17.523 2 12 2zm1.07 12.483-2.549-2.67-4.976 2.67 5.474-5.804 2.612 2.67 4.913-2.67-5.474 5.804z" />
  </svg>
)

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white flex-shrink-0">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
)

interface GameCardProps {
  game: Game
  messengerUrl: string
  instagramUrl: string
}

export function GameCard({ game, messengerUrl, instagramUrl }: GameCardProps) {
  const { location, city, time, cancelled, status, positions } = game

  return (
    <div
      className={`bg-[#1a1d2e] border border-[#252840] rounded-[14px] p-3.5 mb-2.5 ${
        cancelled ? 'opacity-45' : ''
      }`}
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
        <StatusBadge status={status} />
      </div>

      {/* Meta */}
      <p className="text-[12px] text-[#64748b] mb-3">
        {time} · {city}
      </p>

      {/* Position grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {positions.map(pos => (
          <PositionSlot key={pos.name} position={pos} />
        ))}
      </div>

      {/* Inquiry row — hidden for cancelled games */}
      {!cancelled && (
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
    </div>
  )
}
