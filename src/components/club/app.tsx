'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { read } from '@/lib/club/client'
import type { ClubSession } from '@/lib/club/types'
import { DeveloperLog } from './developer-log'
import { ClubIcon, Empty, ErrorNotice } from './primitives'
import { Player } from './player'
import { Staff } from './staff'

export function ClubApp() {
  const [session, setSession] = useState<ClubSession | null>(null)
  const [view, setView] = useState<'games' | 'bookings' | 'staff' | 'developer'>('games')
  const [error, setError] = useState<unknown>(null), [refresh, setRefresh] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  useEffect(() => {
    let active = true
    read<ClubSession>('session').then(value => { if (active) setSession(value) }).catch(error => { if (active) setError(error) })
    const reference = new URLSearchParams(window.location.search).get('authError')
    if (reference) setError(new Error(`Sign-in failed. Reference: ${reference}`))
    return () => { active = false }
  }, [refresh])
  useEffect(() => {
    const refreshSession = () => { if (document.visibilityState === 'visible') setRefresh(value => value + 1) }
    window.addEventListener('focus', refreshSession)
    return () => window.removeEventListener('focus', refreshSession)
  }, [])
  useEffect(() => {
    if (session?.role === 'player' && view === 'staff') setView('games')
    if (session && !session.developer && view === 'developer') setView('games')
  }, [session, view])
  async function signOut() {
    setSigningOut(true)
    try {
      const response = await fetch('/api/club/auth', { method: 'POST' })
      if (!response.ok) throw new Error('Could not sign out')
      setView('games'); setRefresh(value => value + 1)
    } catch (error) { setError(error) } finally { setSigningOut(false) }
  }
  const navigation: { id: typeof view; label: string; icon: 'calendar' | 'ticket' | 'club' | 'code' }[] = [
    { id: 'games', label: 'Games', icon: 'calendar' },
    { id: 'bookings', label: 'My bookings', icon: 'ticket' },
    ...(session && session.role !== 'player' ? [{ id: 'staff', label: 'Manage club', icon: 'club' } as const] : []),
    ...(session?.developer ? [{ id: 'developer', label: 'Developer log', icon: 'code' } as const] : []),
  ]
  return <div className="club-app">
    <a className="club-skip" href="#club-main">Skip to content</a>
    <header className="club-header">
      <a className="club-brand" href="/club"><Image src="/logo.png" width={30} height={60} alt="Dreamers Volleyball Club" priority /><span>DVC<small>Court Play</small></span></a>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className="club-button" aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}><ClubIcon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <div className="club-sidebar-footer"><span className="club-club-mark" aria-hidden="true"><ClubIcon name="court" /></span><strong>Dreamers<br />Volleyball Club</strong><span>Manila time</span></div>
    </header>
    <div className="club-workspace">
      <div className="club-topbar"><span className="club-context">Dreamers Volleyball Club</span><div className="club-user">
        {session?.user ? <><span className="club-account"><strong>{session.user.name}</strong><small>{session.role === 'player' ? 'Player' : session.role === 'developer' ? 'Developer' : session.role === 'admin' ? 'Administrator' : session.role === 'coordinator' ? 'Coordinator' : 'Faci'}</small></span><button className="club-button quiet" disabled={signingOut} onClick={signOut}>Sign out</button></> : session?.configured && <a className="club-button" href="/api/club/auth?start=google">Sign in</a>}
      </div></div>
      <main className="club-main" id="club-main" tabIndex={-1}>
        <ErrorNotice error={error} />
        {Boolean(error) && <button className="club-button" onClick={() => { setError(null); setRefresh(value => value + 1) }}>Retry</button>}
        {!session ? !error && <Empty>Loading…</Empty> : !session.configured ? <div className="club-setup"><h1>See you on court.</h1><p>The new club app is being set up.</p><a className="club-button primary" href="/legacy">View current schedules</a></div> : view === 'staff' ? <Staff userId={session.user?.id || ''} /> : view === 'developer' ? <DeveloperLog /> : <Player key={`${view}-${session.user?.id || 'guest'}`} view={view} session={session} />}
      </main>
      <footer className="club-footer"><span>DVC Court Play</span><span>Volleyball · Manila time</span></footer>
    </div>
  </div>
}
