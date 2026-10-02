// The `orders` Edge Function (P08, D32): the buyer's order page, link recovery and
// return request. All logic lives in `../_shared/orders.ts`, which the unit tests
// import directly.
import { handleOrders } from '../_shared/orders.ts'

Deno.serve((request) => handleOrders(request))
