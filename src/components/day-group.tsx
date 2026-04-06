// src/components/day-group.tsx
import { DaySchedule } from '@/lib/types'
import { GameCard } from './game-card'

interface DayGroupProps {
  day: DaySchedule
  messengerUrl: string
  instagramUrl: string
}

export function DayGroup({ day, messengerUrl, instagramUrl }: DayGroupProps) {
  return (
    <div>
      <h2 className="text-[11px] font-bold tracking-widest text-[#3b82f6] uppercase px-1 pt-3.5 pb-2">
        {day.date}
      </h2>
      {day.games.map(game => (
        <GameCard
          key={game.id}
          game={game}
          messengerUrl={messengerUrl}
          instagramUrl={instagramUrl}
        />
      ))}
    </div>
  )
}
