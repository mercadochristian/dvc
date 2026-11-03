import { ClubApp } from '@/components/club/app'
import LegacyPage from './legacy/page'
export default function Page() { return process.env.DVC_APP_ENABLED === 'true' ? <ClubApp /> : <LegacyPage /> }
