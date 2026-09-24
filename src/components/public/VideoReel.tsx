'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import videoManifestRaw from '../../../public/media/manifest.json'
import styles from './public.module.css'

/**
 * Reads the video manifest directly rather than via `@/lib/content`: this is
 * a client component, and any value-import from content.ts here would bundle
 * Anas's texts into client JS (P01 audit fix 10).
 */
interface VideoManifestEntry {
  file: string
  width: number
  height: number
  poster: string
}
const videoManifest = (videoManifestRaw as unknown as { videos: Record<string, VideoManifestEntry> }).videos

function getVideo(id: string): VideoManifestEntry {
  const entry = videoManifest[id]
  if (!entry) throw new Error(`Missing video manifest entry: ${id}. Run scripts/prepare-media.mjs.`)
  return entry
}

// "Have we hydrated on the client yet?" without setState-in-effect (the React
// team's own recommended idiom): the snapshot is constant true/false, so this
// never triggers extra renders, it just gates React on the client subscribing
// once after the first paint.
function subscribeNever() {
  return () => {}
}
function getClientSnapshot() {
  return true
}
function getServerSnapshot() {
  return false
}
function useHydrated() {
  return useSyncExternalStore(subscribeNever, getClientSnapshot, getServerSnapshot)
}

/**
 * Native `<video>`. When `autoplayOnView` is on (reels) it plays muted/looped
 * once >=60% visible and `prefers-reduced-motion` is off; otherwise — and
 * always for the drone film (DESIGN-DIRECTION.md §3: "never autoplays with
 * sound") — it stays a poster until tapped.
 *
 * Before hydration (and with JS off entirely) the poster shows real native
 * `controls`, fully playable without any script. Once hydrated, native
 * controls stay hidden behind a poster + a real accessible play `<button>`
 * until the user presses play or the reel autoplays; native controls return
 * afterwards (audit fix 6).
 */
export function VideoReel({
  id,
  alt,
  className,
  autoplayOnView = true,
}: {
  id: string
  alt: string
  className?: string
  autoplayOnView?: boolean
}) {
  const video = getVideo(id)
  const ref = useRef<HTMLVideoElement>(null)
  const [tapToPlay, setTapToPlay] = useState(true)
  const hydrated = useHydrated()
  const [manualPlay, setManualPlay] = useState(false)

  useEffect(() => {
    if (!autoplayOnView) return
    const el = ref.current
    if (!el) return
    const motionOk = window.matchMedia('(prefers-reduced-motion: no-preference)').matches
    if (!motionOk) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.6) {
            setTapToPlay(false)
            void el.play().catch(() => setTapToPlay(true))
          } else {
            el.pause()
            // `play()` permanently clears the browser's "show poster" flag;
            // if no frame ever gets composited before pause(), the canvas is
            // stuck black forever, poster included, until reloaded (audit
            // fix 5, the "black built reel" bug). This isn't a fast-scroll
            // race that a "keep the frame if it already painted" heuristic
            // can safely narrow: every reel in a row shares one Y position,
            // so scrolling past the row makes all of them cross the 60%
            // threshold together and race each other's decoders, at any
            // scroll speed. Tried readyState, then requestVideoFrameCallback,
            // then a currentTime>=0.5s floor on top of it (round 3 audit fix
            // 4) — instrumenting play/pause/load directly showed the black
            // tile still recurring under a human-speed (250ms/400px)
            // simulation with every one of those guards, including cases
            // where the reload path *did* fire and it still came back black,
            // which points at a deeper play()/load() overlap race under
            // contention, not something a synchronous JS check can close.
            // Reloading unconditionally is the only version that produced
            // zero black tiles across repeated testing; a correct paused
            // frame is worth more than the saved reload for a muted loop.
            el.load()
            setTapToPlay(true)
          }
        }
      },
      { threshold: [0, 0.6, 1] },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [autoplayOnView])

  function playManually() {
    setManualPlay(true)
    void ref.current?.play()
  }

  // Pre-hydration (and no-JS): native controls, so the poster is playable
  // without any script. Once hydrated: hidden behind a poster + custom button
  // only while genuinely waiting for a tap. The moment a reel is playing by
  // ANY path — autoplay included — native controls must be back, or a
  // looping video has no way to be paused (WCAG 2.2.2; round 2 audit fix 3).
  const showNativeControls = !hydrated || !tapToPlay || manualPlay
  const showCustomButton = hydrated && tapToPlay && !manualPlay

  return (
    <div className={className}>
      <video
        ref={ref}
        className={styles.reelVideo}
        poster={`/${video.poster}`}
        muted
        loop
        playsInline
        preload="none"
        controls={showNativeControls}
        aria-label={alt}
        width={video.width}
        height={video.height}
      >
        <source src={`/${video.file}`} type="video/mp4" />
      </video>
      {showCustomButton && (
        <button type="button" className={styles.playButton} aria-label={`تشغيل: ${alt}`} onClick={playManually}>
          <span aria-hidden="true">▶</span>
        </button>
      )}
    </div>
  )
}
