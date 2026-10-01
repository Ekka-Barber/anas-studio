'use client'

/**
 * The cart's React state (P07): one provider per cart-bearing page (the cart
 * and checkout screens), reading `anasaq:cart:v1` on mount and persisting
 * every change through `src/lib/cart.ts`. `ready` gates rendering so nothing
 * touches localStorage during server rendering, and `persistent` turning
 * false is what shows the honest «السلة مؤقتة…» note. Another tab's change
 * (the `storage` event) is read back at once, and every edit is applied to
 * the latest stored cart, so a stale tab never overwrites what another added.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { CART_STORAGE_KEY, readCart, updateStoredCart, type CartV1 } from '@/lib/cart'

interface CartState {
  ready: boolean
  cart: CartV1
  persistent: boolean
  /** Applies a line-level change (`setQuantity`, `removeLines`, ...) to the latest stored cart. */
  update: (change: (cart: CartV1) => CartV1) => void
}

const CartContext = createContext<CartState | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ cart: CartV1; persistent: boolean } | null>(null)

  useEffect(() => {
    // Deferred to a microtask so the setState is not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => setState(readCart()))
    // Another tab wrote the cart: show it, so nothing here is edited from a stale copy.
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== CART_STORAGE_KEY) return
      const fresh = readCart()
      setState((previous) => ({ cart: fresh.cart, persistent: (previous?.persistent ?? true) && fresh.persistent }))
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const update = useCallback((change: (cart: CartV1) => CartV1) => {
    // Written outside the updater (a side effect) and on every change, so a
    // denied storage still keeps the memory cart current; `persistent` only falls.
    const { cart, saved } = updateStoredCart(change)
    setState((previous) => ({ cart, persistent: (previous?.persistent ?? true) && saved }))
  }, [])

  const value = useMemo<CartState>(
    () => ({
      ready: state !== null,
      cart: state?.cart ?? { version: 1, lines: [] },
      persistent: state?.persistent ?? true,
      update,
    }),
    [state, update],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

/** The cart state inside a `CartProvider`; null when there is none (server rendering). */
export function useCart(): CartState | null {
  return useContext(CartContext)
}
