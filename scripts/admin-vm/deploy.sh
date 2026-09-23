#!/usr/bin/env bash
set -euo pipefail

# ANASAQ admin VM deploy (I19/D27 part 2).
#
# Runs from Git Bash on the owner's PC, from the repository root, against an
# already-provisioned VM (scripts/admin-vm/setup.sh has already run there):
#   ADMIN_VM_HOST=<vm-ip> bash scripts/admin-vm/deploy.sh
#
# Streams the current commit straight into a native `docker build` on the VM
# (no cross-compilation), writes a fixed allowlist of env values to a
# root-owned, mode-600 file on the VM without ever printing a value, and
# replaces the running container. The previous image tag is kept on the VM
# for a manual rollback (docs/admin-vm.md). `set -euo pipefail` above: any
# failed step stops the deploy instead of limping forward with a half-applied
# change.
#
# Required:
#   ADMIN_VM_HOST   the VM's IP or hostname.
# Optional:
#   ADMIN_VM_USER   ssh user (default: ubuntu, Oracle's default cloud-init user).
#   ADMIN_VM_KEY    ssh private key path (default: ~/.ssh/anas-admin.key).

: "${ADMIN_VM_HOST:?Set ADMIN_VM_HOST to the target VM IP before running this script.}"
admin_vm_user="${ADMIN_VM_USER:-ubuntu}"
admin_vm_key="${ADMIN_VM_KEY:-$HOME/.ssh/anas-admin.key}"
ssh_target=("-i" "${admin_vm_key}" "-o" "BatchMode=yes" "${admin_vm_user}@${ADMIN_VM_HOST}")
image_new="anasaq-admin:$(date -u +%Y%m%dt%H%M%Sz)"
container_name=anasaq-admin
env_file=/etc/anasaq-admin.env
state_dir=/opt/anasaq-admin

# Fixed allowlist: only these keys are ever copied from the local `.env` to
# the VM. Widen this list by adding a name deliberately — never by
# pattern-matching the whole file — and never echo a value in this script.
env_keys=(
  PAYLOAD_SECRET
  ADMIN_URL
  CMS_DATABASE_URL
  R2_ENDPOINT
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
  JOBS_SECRET
  TOKEN_HASH_PEPPER
  MFA_ENCRYPTION_KEY
  RESEND_API_KEY
  EMAIL_FROM
  RESEND_WEBHOOK_SECRET
  TURNSTILE_SITE_KEY
  TURNSTILE_SECRET_KEY
  MOYASAR_SECRET_KEY
  WEBHOOK_SECRET
  PAYMENTS_MODE
  SENTRY_DSN
)

if [ ! -f .env ]; then
  echo ".env not found in the current directory — run this from the repository root." >&2
  exit 1
fi
if [ ! -f Dockerfile ]; then
  echo "Dockerfile not found in the current directory — run this from the repository root." >&2
  exit 1
fi

echo "==> Building ${image_new} on the VM (native arm64, streamed from 'git archive HEAD')"
git archive HEAD | ssh "${ssh_target[@]}" "docker build -t ${image_new} -"

echo "==> Writing ${env_file} on the VM (values are never printed here)"
# `grep | cut` would copy surrounding quotes literally, and `docker run
# --env-file` does not strip them — a quoted .env value would reach the
# container with its quotes still attached. Source .env properly instead
# (same pattern as artifacts/acceptance/P00/pooler-probe.mjs), in a subshell
# so it never touches this script's own variables, then read each allowlisted
# key back through bash's own parsing via `${!key}`.
env_payload=$(
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  for key in "${env_keys[@]}"; do
    value="${!key:-}"
    [ -z "${value}" ] && continue
    case "${value}" in
      *$'\n'*)
        # --env-file is one value per line; a newline inside a value would
        # silently truncate or corrupt it. Fail on the key name only — never
        # the value — so this is safe to leave in a terminal or a log.
        echo "Value for ${key} contains a newline; --env-file cannot carry one. Aborting." >&2
        exit 1
        ;;
    esac
    printf '%s=%s\n' "${key}" "${value}"
  done
  echo "RUNTIME_TARGET=node"
)
printf '%s\n' "${env_payload}" | ssh "${ssh_target[@]}" \
  "umask 077 && sudo tee ${env_file} > /dev/null && sudo chown root:root ${env_file} && sudo chmod 600 ${env_file}"

echo "==> Replacing the running container"
ssh "${ssh_target[@]}" bash -s -- "${image_new}" "${container_name}" "${env_file}" "${state_dir}" <<'REMOTE'
set -euo pipefail
image_new="$1"; container_name="$2"; env_file="$3"; state_dir="$4"
sudo mkdir -p "${state_dir}"
previous=$(docker inspect --format '{{.Config.Image}}' "${container_name}" 2>/dev/null || true)
docker rm -f "${container_name}" >/dev/null 2>&1 || true
docker run -d --name "${container_name}" --restart unless-stopped \
  --env-file "${env_file}" -p 127.0.0.1:3000:3000 "${image_new}"
echo "${previous:-none}" | sudo tee "${state_dir}/previous-image.txt" > /dev/null
REMOTE

echo "==> Health check (http://127.0.0.1:3000/api/health on the VM)"
attempt=0
until ssh "${ssh_target[@]}" "curl -fsS http://127.0.0.1:3000/api/health" > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 10 ]; then
    echo "Health check failed after deploy." >&2
    echo "Roll back: ssh into the VM and run the commands in docs/admin-vm.md," >&2
    echo "using the image tag in ${state_dir}/previous-image.txt." >&2
    exit 1
  fi
  sleep 3
done

echo "==> Healthy. Deployed ${image_new}."
