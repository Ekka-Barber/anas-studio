import styles from './signature.module.css'

/**
 * Anas's handwritten signature, "Anas Alqarni", from his own vector file
 * (`public/brand/anas-signature.svg`), drawn in the current text colour so it
 * sits on any band. Never redrawn or retyped. `reveal` writes it in from the
 * start of the stroke when motion is allowed.
 */
export function Signature({ width = 220, reveal = true, className }: { width?: number; reveal?: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label="توقيع أنس القرني"
      className={`${styles.signature} ${className ?? ''}`}
      style={{ inlineSize: `${width}px` }}
      {...(reveal ? { 'data-reveal': '', 'data-fx': 'sign' } : {})}
    />
  )
}
