'use client'

import { useEffect } from 'react'

/**
 * Content is visible by default in plain CSS and stays that way (DESIGN-AUDIT
 * #42): the frozen Motion Spec's opacity-zero entrance is explicitly not
 * reproduced. This component only records the reduced-motion preference as
 * `<html data-motion="ok"|"reduced">`, for the handful of CSS rules that gate
 * non-entrance motion on it (video autoplay, the room pinboard's hover tilt).
 * It never hides or delays already-rendered content.
 */
export function MotionPreference() {
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: no-preference)')

    function applyMotionAttribute() {
      document.documentElement.dataset.motion = query.matches ? 'ok' : 'reduced'
    }
    applyMotionAttribute()
    query.addEventListener('change', applyMotionAttribute)
    return () => query.removeEventListener('change', applyMotionAttribute)
  }, [])

  return null
}
