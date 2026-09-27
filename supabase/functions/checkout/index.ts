// The `checkout` Edge Function (P07, D32). All logic lives in
// `../_shared/checkout.ts`, which the unit tests import directly.
import { handleCheckout } from '../_shared/checkout.ts'

Deno.serve((request) => handleCheckout(request))
