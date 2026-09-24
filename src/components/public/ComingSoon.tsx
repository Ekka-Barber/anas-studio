import styles from './public.module.css'

/** A truthful "قريباً" state for a route that has no real page yet — never a fake one. */
export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <main className={styles.roomPaper}>
      <div className={styles.roomInner}>
        <div className={styles.comingSoon}>
          <span className={styles.comingSoonLabel}>قريباً</span>
          <h1 className={styles.comingSoonTitle}>{title}</h1>
          <p className={styles.comingSoonNote}>{note}</p>
        </div>
      </div>
    </main>
  )
}
