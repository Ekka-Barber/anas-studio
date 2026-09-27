import { CartProvider } from '@/components/store/CartProvider'
import { CartView } from '@/components/store/CartView'
import styles from '@/components/store/store.module.css'

/** السلة (P07): a client screen; prices come from the live quote, storage from src/lib/cart.ts. */
export default function CartPage() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>السلة</h1>
        <noscript>السلة والطلب يحتاجان JavaScript.</noscript>
        <CartProvider>
          <CartView />
        </CartProvider>
      </div>
    </main>
  )
}
