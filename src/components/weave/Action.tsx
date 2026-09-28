import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import styles from './action.module.css'

type Variant = 'solid' | 'outline' | 'text'

function classes(variant: Variant, size: 'md' | 'sm', className?: string) {
  return [styles.action, styles[variant], styles[size], className].filter(Boolean).join(' ')
}

/** The RTL forward arrow that ends every action label in B. */
function Arrow() {
  return (
    <span aria-hidden="true" className={styles.arrow}>
      ←
    </span>
  )
}

/**
 * A link that looks like an action. `solid` takes its band's action colours,
 * `outline` draws a 3px frame in the text colour, `text` is a bare label.
 * Internal links go through next/link (prefetch off, I23); anything with a
 * scheme is a plain anchor.
 */
export function ActionLink({
  href,
  variant = 'solid',
  size = 'md',
  arrow = true,
  className,
  children,
  ...rest
}: {
  href: string
  variant?: Variant
  size?: 'md' | 'sm'
  arrow?: boolean
  className?: string
  children: ReactNode
  'aria-label'?: string
  dir?: 'ltr' | 'rtl'
}) {
  const content = (
    <>
      <span className={styles.label}>{children}</span>
      {arrow && <Arrow />}
    </>
  )
  if (/^[a-z]+:/i.test(href)) {
    return (
      <a href={href} className={classes(variant, size, className)} {...rest}>
        {content}
      </a>
    )
  }
  return (
    <Link href={href} prefetch={false} className={classes(variant, size, className)} {...rest}>
      {content}
    </Link>
  )
}

/** A button with the same three looks as ActionLink. */
export function ActionButton({
  variant = 'solid',
  size = 'md',
  arrow = false,
  className,
  children,
  type = 'button',
  ...rest
}: {
  variant?: Variant
  size?: 'md' | 'sm'
  arrow?: boolean
  className?: string
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classes(variant, size, className)} {...rest}>
      <span className={styles.label}>{children}</span>
      {arrow && <Arrow />}
    </button>
  )
}

/** A short solid label: «قريباً», a category, a status. */
export function Tag({
  variant = 'coral',
  large = false,
  children,
}: {
  variant?: 'coral' | 'ink'
  large?: boolean
  children: ReactNode
}) {
  return <span className={`${styles.tag} ${styles[`tag-${variant}`]} ${large ? styles['tag-lg'] : ''}`}>{children}</span>
}

/**
 * Three small triangles: the mark before Anas's name in the header, and the
 * lead-in of a coral line. Decorative.
 */
export function Mark({ ink = false, className }: { ink?: boolean; className?: string }) {
  return <span aria-hidden="true" className={`${styles.mark} ${ink ? styles.markInk : ''} ${className ?? ''}`} />
}
