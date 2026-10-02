// The `notify` Edge Function (P08, D32): the visitor's "tell me when it is back"
// sign-up, its confirmation and its unsubscribe link. All logic lives in
// `../_shared/notify.ts`, which the unit tests import directly.
import { handleNotify } from '../_shared/notify.ts'

Deno.serve((request) => handleNotify(request))
