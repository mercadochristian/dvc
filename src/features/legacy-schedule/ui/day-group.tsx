// src/features/legacy-schedule/ui/day-group.tsx
import { DaySchedule } from '@/features/legacy-schedule/model/types'
import { GameCard } from './game-card'

interface DayGroupProps {
  day: DaySchedule
  weekId: string
  messengerUrl: string
  instagramUrl: string
}

export function DayGroup({ day, weekId, messengerUrl, instagramUrl }: DayGroupProps) {
  return (
    <div>
      <h2 className="text-[11px] font-bold tracking-widest text-[var(--club-primary)] uppercase px-1 pt-3.5 pb-2">
        {day.date}
      </h2>
      {day.games.map(game => (
        <GameCard
          key={game.id}
          game={game}
          weekId={weekId}
          messengerUrl={messengerUrl}
          instagramUrl={instagramUrl}
        />
      ))}
    </div>
  )
}
