import type { RoomJewel } from '@/lib/content'

import styles from './public.module.css'

/** The frozen room opener: brass tick, small room label in the room's jewel colour, big title. */
export function RoomOpener({
  roomLabel,
  title,
  jewel,
}: {
  roomLabel: string
  title: string
  jewel: RoomJewel
}) {
  return (
    <div className={styles.opener}>
      <div className={styles.openerTick} />
      <span className={styles.openerLabel} style={{ color: `var(--color-${jewel})` }}>
        {roomLabel}
      </span>
      {/* The handoff sets only مررتُ من هنا's title in its jewel; every other room's title is ink. */}
      <h1 className={styles.openerTitle} style={jewel === 'plum' ? { color: 'var(--color-plum)' } : undefined}>
        {title}
      </h1>
    </div>
  )
}
