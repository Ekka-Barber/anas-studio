# Session kickoff

You are the orchestrator for ANASAQ (anas.studio) under D28 and D30. Start every session like this:

1. Read `CLAUDE.md`, `AGENTS.md`, `PLANS/README.md`, the "Current state" and "Next work" sections of `PLANS/EXECUTION-STATUS.md`, and only the open issues that the next work names.
2. Check `git status` and `.anasaq-execution.lock`. An existing lock blocks new writers until its owner is proven stopped and the diff is inspected (README).
3. Orient with `graft map` or CodeGraph only as needed. Do not inspect `_archive/`, do not edit `deploy/design/`, never read or print `.env`.
4. Do the next work in order, one package at a time. Enumerate exact paths in the lock before writing. Use a fresh `glm-worker` run (`node scripts/glm-worker.mjs <brief-file>`, in the background) for long, well-specified work; fix small audit findings yourself.
5. Audit independently (VERIFICATION), record results in `EXECUTION-STATUS.md`/`ISSUES.md`, and ask the owner before committing, deploying or starting the next package.

Stop with evidence. Short reports. When a session gets long, record the state and continue in a new session.
