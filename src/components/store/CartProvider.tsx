'use client'

/**
 * The cart's React state (P07): one provider per cart-bearing page (the cart
 * and checkout screens), reading `anasaq:cart:v1` on mount and persisting
 * every change through `src/lib/cart.ts`. `ready` gates rendering so nothing
 * touches localStorage during server rendering, and `persistent` turning
 * false is what shows the honest «السلة مؤقتة…» note.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { readCart, writeCart, type CartV1 } from '@/lib/cart'

interface CartState {
  ready: boolean
  cart: CartV1
  persistent: boolean
  update: (next: CartV1) => void
}

const CartContext = createContext<CartState | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ cart: CartV1; persistent: boolean } | null>(null)

  useEffect(() => {
    // Deferred to a microtask so the setState is not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => setState(readCart()))
  }, [])

  const update = useCallback((next: CartV1) => {
    // Written outside the updater (a side effect) and on every change, so a
    // denied storage still keeps the memory cart current; `persistent` only falls.
    const saved = writeCart(next)
    setState((previous) => ({ cart: next, persistent: (previous?.persistent ?? true) && saved }))
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
