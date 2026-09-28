'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Cloudflare Turnstile in explicit rendering mode (D16), shared by the
 * checkout and the contact form. The script loads once per page
 * (`…/turnstile/v0/api.js?render=explicit&onload=…`, the documented explicit
 * mode: developers.cloudflare.com/turnstile/get-started/client-side-rendering).
 */
export interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

export function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

/** The widget speaks Arabic and stays light on the sand page. */
export const TURNSTILE_LOOK = { language: 'ar', theme: 'light' } as const

let turnstileScript: Promise<void> | null = null
export function loadTurnstile(): Promise<void> {
  if (turnstileApi()) return Promise.resolve()
  if (turnstileScript === null) {
    turnstileScript = new Promise<void>((resolve, reject) => {
      const global = window as unknown as Record<string, unknown>
      global.__anasaqTurnstileOnload = () => resolve()
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__anasaqTurnstileOnload'
      script.async = true
      script.onerror = () => reject(new Error('turnstile script failed to load'))
      document.head.appendChild(script)
    })
  }
  return turnstileScript
}

/**
 * A Turnstile widget for one form: `box` is the ref callback for its
 * container, `token` the current single-use token (empty until solved), and
 * `reset()` asks for a fresh one after every submission (a token is accepted
 * once, whatever the answer was).
 */
export function useTurnstile(action: string) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const widgetId = useRef<string | null>(null)
  const [token, setToken] = useState('')
  const [failed, setFailed] = useState(false)

  const box = useCallback(
    (el: HTMLDivElement | null) => {
      if (el === null || !siteKey) return
      let gone = false
      loadTurnstile()
        .then(() => {
          if (gone) return
          widgetId.current = turnstileApi()!.render(el, {
            sitekey: siteKey,
            action,
            ...TURNSTILE_LOOK,
            callback: (value: string) => {
              setToken(value)
              setFailed(false)
            },
            'expired-callback': () => setToken(''),
            'error-callback': () => {
              setToken('')
              setFailed(true)
            },
          })
        })
        .catch(() => setFailed(true))
      return () => {
        gone = true
        if (widgetId.current !== null) turnstileApi()?.remove(widgetId.current)
        widgetId.current = null
        setToken('')
      }
    },
    [siteKey, action],
  )

  const reset = useCallback(() => {
    setToken('')
    if (widgetId.current !== null) turnstileApi()?.reset(widgetId.current)
  }, [])

  return { box, token, failed, reset, available: Boolean(siteKey) }
}
