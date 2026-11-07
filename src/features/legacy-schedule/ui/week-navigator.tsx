// src/features/legacy-schedule/ui/week-navigator.tsx

interface WeekNavigatorProps {
  weekNumber: number
  dateRange: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}

export function WeekNavigator({
  weekNumber,
  dateRange,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: WeekNavigatorProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--club-line)] bg-[var(--club-paper)]">
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev}
        className="size-11 shrink-0 rounded-lg bg-[var(--club-line)] text-[var(--club-muted)] text-lg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Previous week"
      >
        ‹
      </button>
      <div className="text-center">
        <p className="text-[16px] font-bold text-[var(--club-ink)]">Week {weekNumber}</p>
        {dateRange && (
          <p className="text-[12px] text-[var(--club-muted)] mt-0.5">{dateRange}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="size-11 shrink-0 rounded-lg bg-[var(--club-line)] text-[var(--club-muted)] text-lg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Next week"
      >
        ›
      </button>
    </div>
  )
}
