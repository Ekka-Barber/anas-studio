// The `contact` Edge Function (D32). All logic lives in
// `../_shared/contact.ts`, which the unit tests import directly.
import { handleContact } from '../_shared/contact.ts'

Deno.serve((request) => handleContact(request))
