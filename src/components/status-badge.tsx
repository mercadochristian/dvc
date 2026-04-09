// src/components/status-badge.tsx
import { GameStatus } from '@/lib/types'

const CONFIG: Record<GameStatus, { label: string; className: string }> = {
  open:        { label: 'Slots open',  className: 'bg-[#14532d] text-[#4ade80]' },
  almost_full: { label: 'Almost full', className: 'bg-[#451a03] text-[#fb923c]' },
  full:        { label: 'Full',        className: 'bg-[#450a0a] text-[#f87171]' },
  cancelled:   { label: 'Cancelled',   className: 'bg-[#1e2535] text-[#94a3b8]' },
  done:        { label: 'Done',        className: 'bg-[#0f172a] text-[#64748b]' },
}

export function StatusBadge({ status }: Readonly<{ status: GameStatus }>) {
  const { label, className } = CONFIG[status]
  return (
    <span
      className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  )
}
