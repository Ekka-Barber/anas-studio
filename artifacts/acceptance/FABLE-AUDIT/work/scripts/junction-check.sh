#!/usr/bin/env bash
# One of round S's proofs that only the owner's machine can give (cloud/S.md, "What only the owner's machine can prove"):
# a real NTFS junction that leads into a repository is refused by the inside-the-repository guard of both scripts,
# `pnpm backup --out` and `pnpm restore-check --extract`, and a plain folder outside is not. It runs on a scratch copy
# (scripts/, patches/, package.json, the lockfile and .npmrc, installed offline from the pnpm store) in one new temp
# folder, never on this working tree; no command reaches a database (no passphrase is available, so a guard that let a
# path through ends at "No passphrase source"). At the end the junction is removed with rmdir, which removes the link and
# never what it points at, and the temp folder only once that junction is gone (pnpm's own junctions in the copy all point
# inside the temp folder).
# Usage: junction-check.sh <label>   -> <label>/summary-junction.txt
set -u
cd "/c/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME" || exit 1
L="${1:?usage: junction-check.sh <label>}"
# a label names a new evidence folder: never an accepted folder or a path, in any case (NTFS ignores case)
case "${L,,}" in -*|*/*|*\\*|.|..|before|ratify-e800fc5|cloud|work) echo "refusing label: $L" >&2; exit 2 ;; esac
: "${TEMP:?TEMP is not set}"
E="artifacts/acceptance/FABLE-AUDIT/$L"; mkdir -p "$E"
S="$PWD/$E/summary-junction.txt"
unset ANASAQ_BACKUP_PASSPHRASE
T="$(cygpath -u "$TEMP")/anasaq-junction-check-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$T/copy" "$T/links" || exit 1
win() { cygpath -w "$1"; }
echo "# junction check ($L), commit $(git rev-parse --short HEAD), $(date -u +%FT%TZ)" > "$S"
cp -r scripts patches package.json pnpm-lock.yaml .npmrc "$T/copy/" || { echo "stopped: the scratch copy failed" >> "$S"; cat "$S"; exit 1; }
(cd "$T/copy" && pnpm install --frozen-lockfile --offline --ignore-scripts > "$T/install.log" 2>&1); INSTALLED=$?
echo "scratch copy installed offline from the pnpm store -> exit $INSTALLED" >> "$S"
MSYS_NO_PATHCONV=1 cmd /c mklink /J "$(win "$T/links/into")" "$(win "$T/copy")" > /dev/null 2>&1
if [ -d "$T/links/into/scripts" ]; then echo "junction made: links\\into -> the scratch copy" >> "$S"; else echo "stopped: the junction could not be made" >> "$S"; rm -rf "$T"; cat "$S"; exit 1; fi
# check <what> <refused|allowed> <script> <arguments...>: refused needs a non-zero exit with "Refusing"; allowed needs no
# "Refusing" and the guard passed, which ends at "No passphrase source" (any other failure is not a pass)
check() {
  local what="$1" want="$2" script="$3"; shift 3
  local out c
  out=$(node "$(win "$T/copy/scripts/$script")" "$@" < /dev/null 2>&1); c=$?
  if [ "$want" = refused ] && [ "$c" -ne 0 ] && printf '%s' "$out" | grep -q "Refusing"; then echo "$what: refused (exit $c), as it must be" >> "$S"
  elif [ "$want" = allowed ] && ! printf '%s' "$out" | grep -q "Refusing" && printf '%s' "$out" | grep -q "No passphrase source"; then echo "$what: not refused (exit $c: $(printf '%s' "$out" | head -1)), as it must be" >> "$S"
  else echo "$what: WRONG, expected $want (exit $c): $(printf '%s' "$out" | head -2 | tr '\n' ' ')" >> "$S"; fi
}
check "backup --out through the junction" refused backup.mjs --local --out "$(win "$T/links/into/backups")"
check "backup --out to a plain folder outside" allowed backup.mjs --local --out "$(win "$T/plain-out")"
if [ "$INSTALLED" -eq 0 ]; then
  check "restore-check --extract through the junction" refused restore-check.mjs "$(win "$T/none.enc")" --extract "$(win "$T/links/into/extract")"
  check "restore-check --extract to a plain folder outside" allowed restore-check.mjs "$(win "$T/none.enc")" --extract "$(win "$T/plain-extract")"
else
  echo "restore-check not checked: the offline install failed ($T/install.log)" >> "$S"
fi
MSYS_NO_PATHCONV=1 cmd /c rmdir "$(win "$T/links/into")" > /dev/null 2>&1
if [ -e "$T/links/into" ] || [ -L "$T/links/into" ]; then
  echo "the junction is still there: $T left in place; remove the link with: cmd /c rmdir $(win "$T/links/into")" >> "$S"
else
  rm -rf "$T" && echo "junction removed with rmdir, then the scratch folder" >> "$S"
fi
echo "done $(date -u +%FT%TZ)" >> "$S"
cat "$S"
