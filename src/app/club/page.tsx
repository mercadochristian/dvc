import { ClubApp } from '@/features/club/ui/shell/app'

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return <ClubApp initialView={(await searchParams).view === 'bookings' ? 'bookings' : 'games'} />
}
