import { ClubApp } from '@/features/club/ui/shell/app'
import LegacyPage from '../features/legacy-schedule/ui/schedule-page'
export default function Page() { return process.env.DVC_APP_ENABLED === 'true' ? <ClubApp /> : <LegacyPage /> }
