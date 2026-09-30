// Where a spec writes its screenshots and notes. Kept apart from helpers.ts,
// which reads `supabase status` on import: visual.spec.ts also runs against a
// static export with no local stack.

/**
 * Only an acceptance run of the spec's own package (ACCEPTANCE_PACKAGE=P07 for
 * the P07 specs) writes into the tracked evidence folder; every other run,
 * including another package's acceptance run, writes to the git-ignored
 * test-results/, so accepted evidence is never replaced.
 */
export function shotsDir(pkg: string): string {
  return process.env.ACCEPTANCE_PACKAGE === pkg ? `artifacts/acceptance/${pkg}/screenshots` : `test-results/screenshots/${pkg}`
}
