#!/usr/bin/env bash
# End-to-end part of the acceptance battery, from a fresh reset. Usage: battery-e2e.sh <label>
set -u
cd "/c/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME" || exit 1
L="$1"; E="artifacts/acceptance/FABLE-AUDIT/$L"; mkdir -p "$E"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
S="$E/summary-e2e.txt"
echo "# e2e battery ($L), commit $(git rev-parse --short HEAD), $(date -u +%FT%TZ), free GB: $(powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)")" > "$S"
run() { local name="$1"; shift; local s=$(date +%s); "$@" > "$E/$name.log" 2>&1; local c=$?; echo "$name -> exit $c ($(( $(date +%s)-s ))s)" >> "$S"; return $c; }
run e2e-db-reset supabase db reset
run e2e-db-import env DATABASE_URL="$DB" pnpm -s db:import
run e2e-db-demo-catalog env DATABASE_URL="$DB" pnpm -s db:demo-catalog
run e2e-db-env pnpm -s db:env
docker restart supabase_edge_runtime_ANASAQ.ME supabase_inbucket_ANASAQ.ME > /dev/null 2>&1; sleep 10
MD5_BEFORE=$(md5sum next-env.d.ts | cut -c1-32)
B1="tests/e2e/public.spec.ts tests/e2e/visual.spec.ts tests/e2e/no-js.spec.ts tests/e2e/motion.spec.ts tests/e2e/reader.spec.ts tests/e2e/auth.spec.ts tests/e2e/cms.spec.ts tests/e2e/media.spec.ts tests/e2e/owner-operations.spec.ts"
B2="tests/e2e/store-admin.spec.ts tests/e2e/cart-checkout.spec.ts tests/e2e/checkout-api.spec.ts tests/e2e/product-availability.spec.ts tests/e2e/order-page.spec.ts tests/e2e/orders-admin.spec.ts tests/e2e/orders-money.spec.ts"
run e2e-batch1 pnpm exec playwright test $B1 --reporter=list
grep -E "passed|failed|flaky|skipped" "$E/e2e-batch1.log" | tail -3 >> "$S"
run e2e-batch2 pnpm exec playwright test $B2 --reporter=list
grep -E "passed|failed|flaky|skipped" "$E/e2e-batch2.log" | tail -3 >> "$S"
run e2e-orders pnpm exec playwright test tests/e2e/orders.spec.ts --global-timeout=900000 --reporter=list
grep -E "passed|failed|flaky|skipped" "$E/e2e-orders.log" | tail -3 >> "$S"
# the dev server rewrites next-env.d.ts; restore it (documented step) and drop the e2e build folder
if [ "$(md5sum next-env.d.ts | cut -c1-32)" != "$MD5_BEFORE" ]; then git checkout -- next-env.d.ts && echo "next-env.d.ts restored" >> "$S"; fi
rm -rf .next/e2e
run typecheck-after pnpm -s typecheck
echo "done $(date -u +%FT%TZ)" >> "$S"
cat "$S"
