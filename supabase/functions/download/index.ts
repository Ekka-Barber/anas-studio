// The `download` Edge Function (P08, D32): a download token for an order's file,
// and a 60-second signed Storage URL for a token. All logic lives in
// `../_shared/download.ts`, which the unit tests import directly.
import { handleDownload } from '../_shared/download.ts'

Deno.serve((request) => handleDownload(request))
