// src/components/position-slot.tsx
import { Position } from '@/lib/types'

export function PositionSlot({ position }: { position: Position }) {
  const { name, available } = position
  const isFull = available === 0
  const isLow = available > 0 && available <= 2

  // Shorten label for display
  const displayName = name === 'Opposite Spiker' ? 'Opposite' : name

  return (
    <div
      className={`rounded-[10px] p-2.5 text-center border ${
        isFull
          ? 'bg-[#1c0a0a] border-[#7f1d1d]'
          : 'bg-[#0f1117] border-[#252840]'
      }`}
    >
      <div className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1">
        {displayName}
      </div>
      {isFull ? (
        <div className="text-sm font-bold text-[#f87171]">Full</div>
      ) : (
        <div
          className={`text-[22px] font-extrabold leading-none ${
            isLow ? 'text-[#fb923c]' : 'text-[#4ade80]'
          }`}
        >
          {available}
        </div>
      )}
    </div>
  )
}
