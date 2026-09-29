import type { Metadata } from 'next'

import { ContactForm } from '@/components/public/contact/ContactForm'
import styles from '@/components/public/contact/contact.module.css'
import { ServiceRequest } from '@/components/public/contact/ServiceRequest'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import layout from '@/components/weave/layout.module.css'
import { Lines } from '@/components/weave/Lines'
import { enter } from '@/components/weave/motion'
import type { Tone } from '@/components/weave/tones'
import { CONTACT } from '@/content/contact'
import { getContact, getSocial } from '@/lib/content'
import { whatsappLink } from '@/lib/format'

export const metadata: Metadata = { title: 'تواصل' }

const SOCIAL_TONES: Tone[] = ['coral', 'saffron', 'paper', 'night']
const SERVICE_TONES: Tone[] = ['paper', 'coral', 'paper', 'saffron', 'paper', 'night']

/**
 * تواصل (D39): Anas's line on coral, the contact form beside his channels
 * (WhatsApp only when its number is set in the admin, then his social links
 * from the admin; no channels, no list), and his consulting services, each
 * of which opens the form with its name.
 */
export default async function ContactPage() {
  const contact = await getContact()
  const social = await getSocial()
  const whatsapp = contact?.whatsapp ? whatsappLink(contact.whatsapp) : null
  return (
    <main id="main">
      <Band as="header" tone="coral" edge="crenel" pad="hero" padEnd="l">
        <h1 className="t-band-xl">
          {CONTACT.title.map((line, i) => (
            <span key={line} className={styles.titleLine} {...enter(80 + i * 280, 'band')}>
              <Lines text={line} />
            </span>
          ))}
        </h1>
      </Band>
      <Edge kind="weave" />

      <Band tone="sand" pad="l" className={styles.body}>
        <ContactForm />
        {(whatsapp || social.length > 0) && (
          <ul className={styles.channels} aria-label="قنوات التواصل">
            {whatsapp && (
              <li>
                <a href={whatsapp} data-tone="aub" className={`${styles.channel} ${styles.channelMain}`}>
                  <span>واتساب</span>
                  <span aria-hidden="true">←</span>
                </a>
              </li>
            )}
            {/* Index keys: two links may share a network name, and the list never reorders on the page. */}
            {social.map((entry, i) => (
              <li key={i}>
                <a href={entry.href} data-tone={SOCIAL_TONES[i % SOCIAL_TONES.length]} className={styles.channel}>
                  <span>{entry.network}</span>
                  <span dir="ltr">{entry.handle}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Band>

      <section id="services" aria-labelledby="services-title">
        <Band tone="aub" edge="crenel" pad="hero" padEnd="m">
          <h2 id="services-title" className="t-band-xl" data-reveal="" data-fx="band">
            {CONTACT.servicesTitle}
          </h2>
          <p className={`t-read ${styles.servicesIntro}`} data-reveal="">
            <Lines text={CONTACT.servicesIntro} />
          </p>
        </Band>
        <ul className={`${layout.lattice} ${styles.services}`}>
          {CONTACT.services.map((service, i) => (
            <li key={service.name} data-tone={SERVICE_TONES[i % SERVICE_TONES.length]} className={styles.service} data-reveal="">
              <h3 className="t-card">{service.name}</h3>
              <p className="t-body">{service.text}</p>
              <ServiceRequest service={service.name} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
