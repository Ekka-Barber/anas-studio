#!/usr/bin/env bash
# End-to-end part of the acceptance battery, from a fresh reset. Usage: battery-e2e.sh <label> [part ...]
# With no part, or "all", it runs setup, batch1, batch2, orders and finish in one go: the run that wrote before/.
# The parts (2026-10-14) let a session run each as its own background command; run each once, in that order:
#   setup                    reset, imports, db:env, the edge runtime and Mailpit restarted; starts summary-e2e.txt afresh
#   batch1, batch2, orders   one Playwright run each, its result lines appended to summary-e2e.txt
#   finish                   next-env.d.ts restored if the dev server rewrote it, .next/e2e removed, typecheck-after
# Playwright empties test-results/playwright at the start of every run, so after each run its files (the failures'
# error-context.md, screenshot and trace) are kept in the git-ignored test-results/kept/<label>-<run>.
set -u
cd "/c/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME" || exit 1
L="${1:?usage: battery-e2e.sh <label> [setup|batch1|batch2|orders|finish|all ...]}"; shift
# a label names a new evidence folder: never a part, an accepted folder or a path (compared in lower case: NTFS ignores case)
case "${L,,}" in -*|*/*|*\\*|.|..|setup|batch1|batch2|orders|finish|all|before|ratify-e800fc5|cloud|work) echo "refusing label: $L" >&2; exit 2 ;; esac
[ $# -eq 0 ] && set -- all
for p in "$@"; do case "$p" in setup|batch1|batch2|orders|finish|all) ;; *) echo "unknown part: $p (setup, batch1, batch2, orders, finish or all)" >&2; exit 2 ;; esac; done
E="artifacts/acceptance/FABLE-AUDIT/$L"; mkdir -p "$E"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
S="$E/summary-e2e.txt"
# next-env.d.ts as it was before the first Playwright run, kept between the parts in the git-ignored test-results/
M="test-results/battery-next-env.md5"
free_gb() { powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"; }
run() { local name="$1"; shift; local s=$(date +%s); "$@" > "$E/$name.log" 2>&1; local c=$?; echo "$name -> exit $c ($(( $(date +%s)-s ))s)" >> "$S"; return $c; }
B1="tests/e2e/public.spec.ts tests/e2e/visual.spec.ts tests/e2e/no-js.spec.ts tests/e2e/motion.spec.ts tests/e2e/reader.spec.ts tests/e2e/auth.spec.ts tests/e2e/cms.spec.ts tests/e2e/media.spec.ts tests/e2e/owner-operations.spec.ts"
B2="tests/e2e/store-admin.spec.ts tests/e2e/cart-checkout.spec.ts tests/e2e/checkout-api.spec.ts tests/e2e/product-availability.spec.ts tests/e2e/order-page.spec.ts tests/e2e/orders-admin.spec.ts tests/e2e/orders-money.spec.ts"
ALL=0
setup() {
  echo "# e2e battery ($L), commit $(git rev-parse --short HEAD), $(date -u +%FT%TZ), free GB: $(free_gb)" > "$S"
  run e2e-db-reset supabase db reset
  run e2e-db-import env DATABASE_URL="$DB" pnpm -s db:import
  run e2e-db-demo-catalog env DATABASE_URL="$DB" pnpm -s db:demo-catalog
  run e2e-db-env pnpm -s db:env
  docker restart supabase_edge_runtime_ANASAQ.ME supabase_inbucket_ANASAQ.ME > /dev/null 2>&1; sleep 10
  mkdir -p test-results && md5sum next-env.d.ts | cut -c1-32 > "$M"
}
# playwright_part <log name> <playwright arguments...>; a part run on its own also records when, on which commit and with how much free memory
playwright_part() {
  local name="$1"; shift
  [ "$ALL" = 1 ] || echo "# $name started $(date -u +%FT%TZ), commit $(git rev-parse --short HEAD), free GB: $(free_gb)" >> "$S"
  run "$name" pnpm exec playwright test "$@" --reporter=list
  grep -E "passed|failed|flaky|skipped" "$E/$name.log" | tail -3 >> "$S"
  if [ -d test-results/playwright ]; then
    rm -rf "test-results/kept/$L-$name" && mkdir -p test-results/kept && cp -r test-results/playwright "test-results/kept/$L-$name"
  fi
}
finish() {
  # the dev server rewrites next-env.d.ts; restore it (documented step) and drop the e2e build folder
  if [ -f "$M" ]; then
    if [ "$(md5sum next-env.d.ts | cut -c1-32)" != "$(cat "$M")" ]; then git checkout -- next-env.d.ts && echo "next-env.d.ts restored" >> "$S"; fi
    rm -f "$M"
  elif ! git diff --quiet -- next-env.d.ts; then
    echo "next-env.d.ts differs from HEAD and no setup of this label kept its state: left as it is" >> "$S"
  fi
  rm -rf .next/e2e
  run typecheck-after pnpm -s typecheck
  echo "done $(date -u +%FT%TZ)" >> "$S"
}
for p in "$@"; do
  case "$p" in
    all)
      ALL=1
      setup
      playwright_part e2e-batch1 $B1
      playwright_part e2e-batch2 $B2
      playwright_part e2e-orders tests/e2e/orders.spec.ts --global-timeout=900000
      finish
      ;;
    setup) setup ;;
    batch1) playwright_part e2e-batch1 $B1 ;;
    batch2) playwright_part e2e-batch2 $B2 ;;
    orders) playwright_part e2e-orders tests/e2e/orders.spec.ts --global-timeout=900000 ;;
    finish) finish ;;
  esac
done
cat "$S"
