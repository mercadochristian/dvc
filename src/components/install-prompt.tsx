'use client'

import { useCallback, useEffect, useState } from 'react'
import { isRecentlyDismissed, markDismissed } from '@/lib/install-prompt'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const SHOW_DELAY_MS = 3000

export function InstallPrompt() {
  const [visible, setVisible] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )

  useEffect(() => {
    // Already installed? Never show.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari legacy check
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true
    if (standalone) return

    if (isRecentlyDismissed()) return

    const ua = window.navigator.userAgent
    const iOS =
      /iPad|iPhone|iPod/.test(ua) &&
      !(window as unknown as { MSStream?: unknown }).MSStream
    setIsIOS(iOS)

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

    const onAppInstalled = () => {
      setVisible(false)
      setDeferred(null)
    }
    window.addEventListener('appinstalled', onAppInstalled)

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      window.clearTimeout(timer)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
    }
    setDeferred(null)
  }, [deferred])

  const handleDismiss = useCallback(() => {
    markDismissed()
    setVisible(false)
  }, [])

  if (!visible) return null

  // On Android/Chromium, stay hidden until Chrome has fired beforeinstallprompt —
  // otherwise the Install button would have nothing to call.
  if (!isIOS && !deferred) return null

  return (
    <div
      role="dialog"
      aria-labelledby="install-prompt-title"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-120 rounded-xl border border-[#252840] bg-[#13151f] p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2
            id="install-prompt-title"
            className="text-[15px] font-semibold leading-tight text-[#f1f5f9]"
          >
            Install DVC Fun Games
          </h2>
          {isIOS ? (
            <p className="mt-1 text-[12px] leading-snug text-[#94a3b8]">
              Tap the Share button in Safari, then choose{' '}
              <span className="font-medium text-[#f1f5f9]">
                Add to Home Screen
              </span>{' '}
              to install this app.
            </p>
          ) : (
            <p className="mt-1 text-[12px] leading-snug text-[#94a3b8]">
              Add it to your home screen for faster access.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
          className="cursor-pointer px-1 text-lg leading-none text-[#64748b] hover:text-[#f1f5f9]"
        >
          ×
        </button>
      </div>

      {!isIOS && deferred && (
        <button
          type="button"
          onClick={handleInstall}
          className="mt-3 w-full cursor-pointer rounded-lg bg-[#3b82f6] py-2 text-sm font-medium text-white hover:bg-[#2563eb]"
        >
          Install
        </button>
      )}
    </div>
  )
}
