import { Picture } from './Picture'
import styles from './public.module.css'

/**
 * A generated watercolour room vignette (DESIGN-DIRECTION.md §3): circular,
 * dissolving into the paper background, decorative — empty alt, it never
 * carries meaning on its own (the room title/paragraphs around it do).
 */
export function Vignette({ id, className, wide }: { id: string; className?: string; wide?: boolean }) {
  return (
    <div className={`${styles.vignette} ${wide ? styles.vignetteWide : ''} ${className ?? ''}`}>
      <Picture id={id} alt="" sizes={wide ? '(min-width: 768px) 720px, 100vw' : '(min-width: 768px) 360px, 60vw'} />
    </div>
  )
}
