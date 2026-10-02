// The `payments` Edge Function (P08, D32): the Moyasar webhook, the invoice
// callback and the return page's check. All logic lives in
// `../_shared/payments.ts`, which the unit tests import directly.
import { handlePayments } from '../_shared/payments.ts'

Deno.serve((request) => handlePayments(request))
