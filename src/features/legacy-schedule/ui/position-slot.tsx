// src/features/legacy-schedule/ui/position-slot.tsx
import { Position } from '@/features/legacy-schedule/model/types'

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
          ? 'bg-[#1c0a0a] border-[var(--club-danger-bg)]'
          : 'bg-[var(--club-bg)] border-[var(--club-control-hover)]'
      }`}
    >
      <div className="text-[10px] text-[var(--club-muted)] uppercase tracking-wide mb-1">
        {displayName}
      </div>
      {isFull ? (
        <div className="text-sm font-bold text-[var(--club-danger)]">Full</div>
      ) : (
        <div
          className={`text-[22px] font-extrabold leading-none ${
            isLow ? 'text-[var(--club-primary)]' : 'text-[var(--club-success)]'
          }`}
        >
          {available}
        </div>
      )}
    </div>
  )
}
