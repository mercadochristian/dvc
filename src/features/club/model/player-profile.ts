import { GENDER_LABEL, LEVEL_LABEL, type PlayerProfile } from './types'
export function playerProfileFrom(form: FormData, prefix = '') {
  const age = form.get(`${prefix}age`), firstTimer = form.get(`${prefix}first_timer`)
  return { level: form.get(`${prefix}level`) || null, gender: form.get(`${prefix}gender`) || null,
    age: age === null || String(age).trim() === '' ? null : Number(age), birth_date: form.get(`${prefix}birth_date`) || null, first_timer: firstTimer === 'true' ? true : firstTimer === 'false' ? false : null }
}
export function ageOnDate(birthday: string, onDate: string): number {
  const [year, month, day] = birthday.split('-').map(Number), [endYear, endMonth, endDay] = onDate.slice(0, 10).split('-').map(Number)
  return endYear - year - (endMonth < month || (endMonth === month && endDay < day) ? 1 : 0)
}
export function profileSummary(profile: Partial<PlayerProfile>) {
  return [profile.level ? LEVEL_LABEL[profile.level] : null, profile.age === null || profile.age === undefined ? null : `Age ${profile.age}`, profile.gender ? GENDER_LABEL[profile.gender] : null].filter(Boolean).join(' · ')
}
