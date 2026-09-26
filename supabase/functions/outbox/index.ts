// The `outbox` Edge Function (D32). All logic lives in
// `../_shared/jobs.ts`, which the unit tests import directly.
import { handleJobs } from '../_shared/jobs.ts'

Deno.serve((request) => handleJobs(request))
