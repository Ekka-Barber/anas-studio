# Common rules for every CLEANUP-1 worker round

- **The lock.** You work under the orchestrator's lock (`.anasaq-execution.lock`; read its `allowedPaths`). You are the only writer while you run.
  - Write only the paths your brief names that are also inside the lock.
  - Do not commit, push, or start other work. The orchestrator audits, runs the full battery and commits on the owner's word.
- **Never:**
  - inspect `_archive/`, edit `deploy/design/`, or read or print `.env` or any secret (secrets come only through environment variables);
  - write a polling loop;
  - invent prices, approvals or gate closures;
  - reword Anas's words. Moving existing data verbatim from code into `content/initial-content.json` is allowed; rewording it is not.
- **Plan of record.** `PLANS/` is the plan of record and every decision in `PLANS/DECISIONS.md` is settled. `DESIGN.md` is the design reference: keep every public page looking exactly as it does now unless your brief says otherwise.
- **Servers.** A dev server is already running on `http://localhost:3000`, and Playwright's config reuses it; do not stop it. Do not run `pnpm build`: the orchestrator builds at the end. The local Supabase stack is expected to be up. Never run `supabase db reset` or `supabase stop --no-backup`, which wipe the imported content. Apply a new migration with `supabase migration up --local`. `pnpm db:import --force` is allowed; it re-imports `content/initial-content.json` locally.
- **Before any e2e.** Check free RAM with `(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory`. Under 6 GB, stop and report.
  - Run only the specs your brief names.
  - If a run rewrites tracked evidence under `artifacts/acceptance/<other package>/`, restore it with `git checkout -- <path>`.
- **Style.**
  - Match the surrounding code: TypeScript strict, CSS Modules, logical properties, Arabic UI copy.
  - Shortest working change. Comments only where the code does something non-obvious, in the house voice (plain English sentences).
- **Checks to run yourself:** `npx eslint <changed files>`, `pnpm -s typecheck`, `pnpm -s test`, plus the targeted tests your brief names.
- **Report.** Return:
  - the files changed;
  - each command with its exit code and pass/fail counts;
  - anything not done, and why;
  - risks;
  - any product decision you needed and did not take (stop and report rather than guess).

  Also write the same report to `artifacts/acceptance/CLEANUP-1/<your round>.md`.
