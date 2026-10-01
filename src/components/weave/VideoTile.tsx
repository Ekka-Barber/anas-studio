'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import videoManifestRaw from '../../../public/media/manifest.json'

import styles from './video.module.css'

/**
 * One of Anas's films, B's way: the poster with a coral «تشغيل» label sewn
 * on its corner, playing only when asked (never autoplays, never loads a
 * byte before the tap: `preload="none"`). Muted at first; once playing, the
 * browser's own controls take over for pause, sound and fullscreen.
 *
 * Without JavaScript, and before hydration, the native controls are the
 * control, so the film is always playable.
 */
interface VideoEntry {
  file: string
  width: number
  height: number
  poster: string
}
const manifest = (videoManifestRaw as unknown as { videos: Record<string, VideoEntry> }).videos

function subscribe() {
  return () => {}
}
const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

export function VideoTile({
  id,
  alt,
  ratio,
  focus,
  large = false,
  className,
}: {
  id: string
  alt: string
  /** The frame's shape, e.g. "9 / 16"; defaults to the film's own. */
  ratio?: string
  focus?: string
  /** The bigger label, for a full-width film. */
  large?: boolean
  className?: string
}) {
  // An own key only: an inherited one («constructor») would pass as an entry.
  const entry = Object.hasOwn(manifest, id) ? manifest[id] : undefined
  const ref = useRef<HTMLVideoElement>(null)
  const hydrated = useHydrated()
  const [state, setState] = useState<'idle' | 'playing' | 'failed'>('idle')

  if (!entry) throw new Error(`Missing video manifest entry: ${id}. Run scripts/prepare-media.mjs.`)

  function start() {
    const video = ref.current
    if (!video) return
    setState('playing')
    video.play().catch((error: unknown) => {
      // Pausing before the first bytes arrive rejects play() with an AbortError; nothing failed.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setState('failed')
    })
  }

  // The play button unmounts once the film starts; focus goes to the film,
  // whose native controls come next, instead of falling to <body>.
  useEffect(() => {
    if (state === 'playing') ref.current?.focus()
  }, [state])

  const waiting = hydrated && state !== 'playing'
  return (
    <div
      className={`${styles.tile} ${className ?? ''}`}
      style={{ aspectRatio: ratio ?? `${entry.width} / ${entry.height}` }}
    >
      <video
        ref={ref}
        className={styles.video}
        style={focus ? { objectPosition: focus } : undefined}
        poster={`/${entry.poster}`}
        muted
        loop
        playsInline
        preload="none"
        controls={!waiting}
        aria-label={alt}
        width={entry.width}
        height={entry.height}
      >
        <source src={`/${entry.file}`} type="video/mp4" />
      </video>
      {waiting && (
        <button type="button" className={styles.play} aria-label={`تشغيل: ${alt}`} onClick={start}>
          <span className={`${styles.chip} ${large ? styles.chipLarge : ''}`}>
            <span aria-hidden="true" className={styles.triangle} />
            تشغيل
          </span>
        </button>
      )}
      {/* Always mounted: a status inserted already filled is often missed by screen readers. */}
      <p role="status" className={state === 'failed' ? styles.status : 'visually-hidden'}>
        {state === 'failed' ? 'تعذّر تشغيل المقطع. حاول مرة أخرى.' : ''}
      </p>
    </div>
  )
}
