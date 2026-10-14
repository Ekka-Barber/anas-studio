#!/usr/bin/env bash
# The backup rehearsal with a paid file, on the local stack: one real `pnpm backup --local` and `pnpm restore-check <file>`
# (ISSUES I53 (3); docs/operations.md, "No backup rehearsal with a paid file yet"; cloud/S.md, "What only the owner's
# machine can prove"). Usage: battery-backup.sh <label>   -> <label>/summary-backup.txt and <label>/backup-restore-check.log
# The backup file and the full output stay outside the repository, in a new folder under ~/ANASAQ-backups; the record gets
# only restore-check's own lines, with anything key-shaped removed. The passphrase is made here for this run and never
# printed, so nobody can open the file afterwards: it is deleted at the end. When the bucket holds no paid file, one is
# uploaded for the run (paid-file.mjs) and removed again afterwards. While the scratch stack runs, its containers and
# volumes are listed by the CLI's project label and by name: the two lists must agree, every published port must be on
# 127.0.0.1, and afterwards nothing may remain by either. Never --linked: that is the hosted project.
set -u
cd "/c/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME" || exit 1
L="${1:?usage: battery-backup.sh <label>}"
# a label names a new evidence folder: never an accepted folder or a path, in any case (NTFS ignores case)
case "${L,,}" in -*|*/*|*\\*|.|..|before|ratify-e800fc5|cloud|work) echo "refusing label: $L" >&2; exit 2 ;; esac
E="artifacts/acceptance/FABLE-AUDIT/$L"; mkdir -p "$E"
S="$E/summary-backup.txt"; R="$E/backup-restore-check.log"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
W="$HOME/ANASAQ-backups/rehearsal-$STAMP"; mkdir -p "$W" || exit 1
WN="~/ANASAQ-backups/rehearsal-$STAMP"
P=anasaq-restore-check
paid() { node artifacts/acceptance/FABLE-AUDIT/work/scripts/paid-file.mjs "$@"; }
sql() { docker exec supabase_db_ANASAQ.ME psql -U postgres -d postgres -tAc "$1" | tr -d '[:space:]'; }
dev() { docker ps --filter name=_ANASAQ.ME --format '{{.Names}}' | sort; }
count() { wc -l < "$1" | tr -d ' '; }
# Removes anything shaped like a key from a record line: a JWT, a Supabase API key, a private key block.
redact() { sed -E 's/eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+)*/[key-shaped value removed]/g; s/sb_(secret|publishable)_[A-Za-z0-9_-]+/[key-shaped value removed]/g; s/-----BEGIN [A-Z ]+-----/[key-shaped value removed]/g'; }
# An early stop: the summary is redacted like the normal end's, then printed.
stop() { echo "$1" >> "$S"; redact < "$S" > "$S.tmp" && mv "$S.tmp" "$S"; cat "$S"; exit 1; }
echo "# backup rehearsal ($L), commit $(git rev-parse --short HEAD), $(date -u +%FT%TZ)" > "$S"
dev > "$W/dev-before.txt"
echo "development stack ANASAQ.ME: $(count "$W/dev-before.txt") containers running" >> "$S"
KEY=""
N=$(sql "select count(*) from storage.objects where bucket_id = 'paid-files'")
case "$N" in ''|*[!0-9]*) stop "stopped: the paid-files count could not be read (\"$N\"); is the stack running? (the run's folder: $WN)" ;; esac
if [ "$N" = "0" ]; then
  KEY="assets/backup-rehearsal/$STAMP.pdf"
  if ! paid put "$KEY" >> "$S" 2>&1; then stop "stopped: no paid file to rehearse with (the run's folder: $WN)"; fi
  N=$(sql "select count(*) from storage.objects where bucket_id = 'paid-files'")
fi
echo "paid-files holds $N object(s) before the backup" >> "$S"
ANASAQ_BACKUP_PASSPHRASE=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")
export ANASAQ_BACKUP_PASSPHRASE
s=$(date +%s); pnpm -s backup --local --out "$(cygpath -w "$W")" > "$W/backup.log" 2>&1; c=$?
echo "backup --local -> exit $c ($(( $(date +%s)-s ))s)" >> "$S"
grep -E "^Size:" "$W/backup.log" | redact >> "$S"
F=$(ls "$W"/anasaq-backup-*.enc 2>/dev/null | head -1)
if [ "$c" -ne 0 ] || [ -z "$F" ]; then
  rm -f "$W"/anasaq-backup-*.enc
  if [ -n "$KEY" ]; then paid remove "$KEY" >> "$S" 2>&1; fi
  stop "stopped: no backup file (full output: $WN/backup.log)"
fi
echo "backup file: $(basename "$F"), $(wc -c < "$F" | tr -d ' ') bytes, sha256 $(sha256sum "$F" | cut -c1-64)" >> "$S"
# restore-check, with one look at the scratch stack when its objects start to upload (the stack is up then)
s=$(date +%s)
pnpm -s restore-check "$(cygpath -w "$F")" 2>&1 | while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "$line" >> "$W/restore-check.log"
  case "$line" in
    "Uploading storage objects..."*)
      docker ps -a --filter "label=com.supabase.cli.project=$P" --format '{{.Names}}' > "$W/probe-containers.txt" 2>&1
      docker volume ls --filter "label=com.supabase.cli.project=$P" --format '{{.Name}}' > "$W/probe-volumes.txt" 2>&1
      docker ps -a --filter "name=$P" --format '{{.Names}}' > "$W/probe-containers-by-name.txt" 2>&1
      docker volume ls --filter "name=$P" --format '{{.Name}}' > "$W/probe-volumes-by-name.txt" 2>&1
      sort -u "$W/probe-containers.txt" "$W/probe-containers-by-name.txt" | while IFS= read -r n; do docker port "$n"; done > "$W/probe-port.txt" 2>&1
      ;;
  esac
done
c=${PIPESTATUS[0]}
echo "restore-check -> exit $c ($(( $(date +%s)-s ))s)" >> "$S"
# The record: restore-check's own lines. What the CLI prints while the scratch stack starts and the dumps load (the stack's
# local keys among it) is left out, except the lines that say what went wrong.
awk '
  /^Starting the throwaway stack/ { print; skip = 1; next }
  /^Uploading storage objects/ { skip = 0 }
  skip && /^(Caveat applied|The psql restore failed|Refusing|Cleanup step failed|Scratch stack removed|The scratch stack was not removed|Could not check|Remove it with)|failed \(exit [0-9]+\)|Error: / { print; next }
  !skip { print }
' "$W/restore-check.log" | redact > "$R"
PASS=1
[ "$c" -eq 0 ] || PASS=0
if [ -f "$W/probe-containers.txt" ]; then
  echo "while the scratch stack ran: $(count "$W/probe-containers.txt") container(s) and $(count "$W/probe-volumes.txt") volume(s) labelled com.supabase.cli.project=$P; by name: $(count "$W/probe-containers-by-name.txt") and $(count "$W/probe-volumes-by-name.txt")" >> "$S"
  sed 's/^/  container /' "$W/probe-containers.txt" >> "$S"
  sed 's/^/  volume /' "$W/probe-volumes.txt" >> "$S"
  sed 's/^/  docker port: /' "$W/probe-port.txt" >> "$S"
  if [ "$(count "$W/probe-containers.txt")" = "0" ] || [ "$(count "$W/probe-volumes.txt")" = "0" ]; then echo "  the label matched nothing while the stack ran" >> "$S"; PASS=0; fi
  if ! cmp -s <(sort "$W/probe-containers.txt") <(sort "$W/probe-containers-by-name.txt") || ! cmp -s <(sort "$W/probe-volumes.txt") <(sort "$W/probe-volumes-by-name.txt"); then
    echo "  the lists by label and by name differ: a container or volume named for $P does not carry the label" >> "$S"; PASS=0
  fi
  if [ "$(grep -c . "$W/probe-port.txt")" = "0" ] || grep -v '127\.0\.0\.1:' "$W/probe-port.txt" | grep -q .; then echo "  a published port is missing or not on 127.0.0.1" >> "$S"; PASS=0; fi
else
  echo "no look at the scratch stack: restore-check stopped before uploading its objects" >> "$S"; PASS=0
fi
LC=$(docker ps -a --filter "label=com.supabase.cli.project=$P" -q | wc -l | tr -d ' ')
LV=$(docker volume ls --filter "label=com.supabase.cli.project=$P" -q | wc -l | tr -d ' ')
LN=$(docker network ls --filter "name=supabase_network_$P" -q | wc -l | tr -d ' ')
LCN=$(docker ps -a --filter "name=$P" -q | wc -l | tr -d ' ')
LVN=$(docker volume ls --filter "name=$P" -q | wc -l | tr -d ' ')
echo "after the run: by label, $LC container(s) and $LV volume(s) of $P remain; by name, $LCN container(s), $LVN volume(s) and $LN network(s)" >> "$S"
[ "$LC$LV$LN$LCN$LVN" = "00000" ] || PASS=0
grep -q "^Scratch stack removed" "$W/restore-check.log" && echo "the run ended with \"Scratch stack removed\"" >> "$S" || PASS=0
dev > "$W/dev-after.txt"
if cmp -s "$W/dev-before.txt" "$W/dev-after.txt"; then
  echo "development stack ANASAQ.ME: the same $(count "$W/dev-after.txt") containers running after the run" >> "$S"
else
  echo "development stack ANASAQ.ME CHANGED: before: $(tr '\n' ' ' < "$W/dev-before.txt")| after: $(tr '\n' ' ' < "$W/dev-after.txt")" >> "$S"; PASS=0
fi
if [ -n "$KEY" ]; then paid remove "$KEY" >> "$S" 2>&1 || echo "the rehearsal's paid file is still in the bucket: $KEY" >> "$S"; fi
unset ANASAQ_BACKUP_PASSPHRASE
rm -f "$F" && echo "backup file deleted (its passphrase existed only in this run); the full output stays in $WN" >> "$S"
if grep -qE 'eyJ[A-Za-z0-9_-]{8,}|sb_(secret|publishable)_[A-Za-z0-9_-]{4,}' "$S" "$R" || grep -qE '[0-9a-f]{32,}' "$R"; then
  : > "$R"; redact < "$S" > "$S.tmp" && mv "$S.tmp" "$S"
  echo "key-shaped text found in the record: backup-restore-check.log emptied and the summary redacted; read the full output in $WN" >> "$S"; PASS=0
fi
[ "$PASS" = 1 ] && echo "verdict: PASS" >> "$S" || echo "verdict: FAIL (see the lines above and $WN)" >> "$S"
echo "done $(date -u +%FT%TZ)" >> "$S"
cat "$S"
[ "$PASS" = 1 ]
