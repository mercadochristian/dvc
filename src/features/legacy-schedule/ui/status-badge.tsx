// src/features/legacy-schedule/ui/status-badge.tsx
import { GameStatus } from '@/features/legacy-schedule/model/types'

const CONFIG: Record<GameStatus, { label: string; className: string }> = {
  open:        { label: 'Slots open',  className: 'bg-[#14532d] text-[var(--club-success)]' },
  almost_full: { label: 'Almost full', className: 'bg-[#451a03] text-[var(--club-primary)]' },
  full:        { label: 'Full',        className: 'bg-[#450a0a] text-[var(--club-danger)]' },
  cancelled:   { label: 'Cancelled',   className: 'bg-[var(--club-line)] text-[var(--club-muted)]' },
  done:        { label: 'Done',        className: 'bg-[#0f172a] text-[var(--club-muted)]' },
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
