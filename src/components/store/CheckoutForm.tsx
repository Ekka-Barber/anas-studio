'use client'

/**
 * The checkout page's form, as a shell (RESIDUALS-1 R4a, ISSUES I50 (2)): the page's first script was at the public
 * budget (150 KiB gzip, `pnpm check:budgets`), so the form's body, with the helpers only it imports, is its own chunk
 * (`CheckoutBody.tsx`) and this file is all the first script carries of it. The props are the body's. Until the chunk
 * is there, and while the body reads the cart, the page shows one empty status line: no static page carries a loading
 * line that only script ends (STORE-UI-03), and the two renders are the same markup, so nothing flashes between them.
 * A chunk that cannot be loaded (the connection, or the site changed since this page was opened) says so, with the
 * hold view's own sentence: the error page's retry could not load it again (`lazy` keeps the failure).
 */

import { lazy, Suspense } from 'react'

import styles from './store.module.css'

function CheckoutBodyLost(_props: { builtRevisions: Record<string, number> }) {
  return (
    <p className={styles.warning} role="alert">
      تعذّر تحميل الطلب؛ حدّث الصفحة.
    </p>
  )
}
const CheckoutBody = lazy(() =>
  import('./CheckoutBody').then(
    (module) => ({ default: module.CheckoutBody }),
    () => ({ default: CheckoutBodyLost }),
  ),
)

export function CheckoutForm({ builtRevisions }: { builtRevisions: Record<string, number> }) {
  return (
    <Suspense fallback={<p role="status" className="visually-hidden" />}>
      <CheckoutBody builtRevisions={builtRevisions} />
    </Suspense>
  )
}
