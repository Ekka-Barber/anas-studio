#!/usr/bin/env bash
# Stack-dependent part of the acceptance battery: fresh reset, imports, test:db, build, export and budget checks.
# Usage: battery-db.sh <label>   -> logs under artifacts/acceptance/FABLE-AUDIT/<label>/
set -u
cd "/c/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME" || exit 1
L="$1"; E="artifacts/acceptance/FABLE-AUDIT/$L"; mkdir -p "$E"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
S="$E/summary-db.txt"
echo "# stack battery ($L), commit $(git rev-parse --short HEAD), $(date -u +%FT%TZ)" > "$S"
run() { local name="$1"; shift; local s=$(date +%s); "$@" > "$E/$name.log" 2>&1; local c=$?; echo "$name -> exit $c ($(( $(date +%s)-s ))s)" >> "$S"; return $c; }
run db-reset supabase db reset
run db-import env DATABASE_URL="$DB" pnpm -s db:import
run db-demo-catalog env DATABASE_URL="$DB" pnpm -s db:demo-catalog
run db-env pnpm -s db:env
run edge-restart docker restart supabase_edge_runtime_ANASAQ.ME
sleep 8
run test-db env TEST_ENV=local DATABASE_URL="$DB" pnpm -s test:db
grep -E "Test Files|Tests " "$E/test-db.log" | tail -2 >> "$S"
run build pnpm -s build
run check-export pnpm -s check:export
grep -E "OK|FAIL|required" "$E/check-export.log" | head -4 >> "$S"
run check-budgets pnpm -s check:budgets
grep -E "OK|FAIL|largest" "$E/check-budgets.log" | head -3 >> "$S"
echo "done $(date -u +%FT%TZ)" >> "$S"
cat "$S"
