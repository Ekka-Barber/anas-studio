// The `admin` Edge Function (D32). All logic lives in
// `../_shared/admin.ts`, which the unit tests import directly.
import { handleAdmin } from '../_shared/admin.ts'

Deno.serve((request) => handleAdmin(request))
