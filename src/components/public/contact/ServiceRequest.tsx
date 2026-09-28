'use client'

import { SERVICE_EVENT } from './ContactForm'
import styles from './contact.module.css'

/**
 * «اطلب جلسة» on a service. A link to the form, so it still takes you there
 * without JavaScript; with it, the service's name also opens the message.
 */
export function ServiceRequest({ service }: { service: string }) {
  return (
    <a
      href="#contact-form"
      className={styles.request}
      onClick={() => window.dispatchEvent(new CustomEvent(SERVICE_EVENT, { detail: service }))}
    >
      اطلب جلسة <span aria-hidden="true">←</span>
    </a>
  )
}
