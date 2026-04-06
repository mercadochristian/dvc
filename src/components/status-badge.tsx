// src/components/status-badge.tsx
import { GameStatus } from '@/lib/types'

const CONFIG: Record<GameStatus, { label: string; className: string }> = {
  open:        { label: 'Slots open',  className: 'bg-[#14532d] text-[#4ade80]' },
  almost_full: { label: 'Almost full', className: 'bg-[#451a03] text-[#fb923c]' },
  full:        { label: 'Full',        className: 'bg-[#450a0a] text-[#f87171]' },
  cancelled:   { label: 'Cancelled',   className: 'bg-[#1e2535] text-[#94a3b8]' },
}

export function StatusBadge({ status }: { status: GameStatus }) {
  const { label, className } = CONFIG[status]
  return (
    <span
      className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ml-2 mt-0.5 ${className}`}
    >
      {label}
    </span>
  )
}
