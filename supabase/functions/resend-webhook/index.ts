// The `resend-webhook` Edge Function (D32). All logic lives in
// `../_shared/resend-webhook.ts`, which the unit tests import directly.
import { handleResendWebhook } from '../_shared/resend-webhook.ts'

Deno.serve((request) => handleResendWebhook(request))
