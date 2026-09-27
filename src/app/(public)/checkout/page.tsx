import { CartProvider } from '@/components/store/CartProvider'
import { CheckoutForm } from '@/components/store/CheckoutForm'
import styles from '@/components/store/store.module.css'

/** إتمام الطلب (P07): a client screen; the same live quote the cart showed. */
export default function CheckoutPage() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>إتمام الطلب</h1>
        <noscript>السلة والطلب يحتاجان JavaScript.</noscript>
        <CartProvider>
          <CheckoutForm />
        </CartProvider>
      </div>
    </main>
  )
}
