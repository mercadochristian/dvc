// src/components/week-navigator.tsx

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
    <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2535] bg-[#161824]">
      <button
        onClick={onPrev}
        disabled={!canPrev}
        className="w-[30px] h-[30px] rounded-lg bg-[#1e2535] text-[#94a3b8] text-lg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Previous week"
      >
        ‹
      </button>
      <div className="text-center">
        <p className="text-[16px] font-bold text-[#f1f5f9]">Week {weekNumber}</p>
        {dateRange && (
          <p className="text-[12px] text-[#64748b] mt-0.5">{dateRange}</p>
        )}
      </div>
      <button
        onClick={onNext}
        disabled={!canNext}
        className="w-[30px] h-[30px] rounded-lg bg-[#1e2535] text-[#94a3b8] text-lg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Next week"
      >
        ›
      </button>
    </div>
  )
}
