# Admin VM runbook (I19/D27)

The Payload admin, authentication, REST/GraphQL writes and the native job
runner run as a Node server (this repo's `Dockerfile`) on an Oracle Cloud
Always Free Ampere A1 VM, published at `https://admin.anas.studio` through a
Cloudflare Tunnel. The public site stays on Cloudflare Workers — nothing here
changes that. See `PLANS/ISSUES.md` I17/I19 for why, and `PLANS/DECISIONS.md`
D27 for the amendment once it is recorded.

This is the owner's runbook. Nothing in `scripts/admin-vm/` runs itself;
`PLANS/EXECUTION-STATUS.md` and `PLANS/ISSUES.md` track what has actually been
provisioned, not this file.

Known, accepted gap: `importMap.js` lacks `@payloadcms/storage-s3/client#S3ClientUploadHandler`, so the node admin logs a non-fatal `getFromImportMap` warning; `clientUploads` is off, so it has no function, and it is left alone on purpose because a subpath import could defeat the Worker alias — a later package revisits it.

## Env the VM needs

Set these for real in `.env` on the owner's PC before running `deploy.sh` —
`scripts/admin-vm/deploy.sh`'s fixed allowlist copies only the keys it knows
about (see the `env_keys` array in that script) into a root-owned, mode-600
file on the VM. Nothing is ever printed while doing so.

Required (the container refuses to start without all of these — see
`Dockerfile`'s `CMD`):

| Key | What it is |
| --- | --- |
| `PAYLOAD_SECRET` | Same secret already used elsewhere; Payload's session/cookie signing key. |
| `ADMIN_URL` | `https://admin.anas.studio` — becomes Payload's `serverURL` and the CSRF allowlist entry. |
| `CMS_DATABASE_URL` | The Supabase transaction-pooler URL. **Not** `DATABASE_URL` — that is the separate D26 migration credential and must never be used at runtime. |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | R2's S3-compatible API credentials. The Worker uses the native R2 binding instead; the VM has no binding, so it reaches the same bucket over S3. |

Also copied if present in `.env` (optional features, `.env.example` lists all
of them): `JOBS_SECRET`, `TOKEN_HASH_PEPPER`, `MFA_ENCRYPTION_KEY`,
`RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET_KEY`, `MOYASAR_SECRET_KEY`, `WEBHOOK_SECRET`,
`PAYMENTS_MODE`, `SENTRY_DSN`.

## One-time VM setup

```sh
# on the VM itself, as a regular sudo user (not root)
bash scripts/admin-vm/setup.sh
```

Installs Docker, enables `unattended-upgrades`, and adds an 8 GB swap file
(the VM has 1 OCPU / 6 GB — tight for an on-VM `docker build`). It does not
touch firewall rules: Oracle's default iptables image only opens SSH, and the
tunnel needs no inbound port. Idempotent — safe to re-run.

## Deploy

```sh
# from Git Bash on the owner's PC, from the repository root
ADMIN_VM_HOST=<vm-ip> bash scripts/admin-vm/deploy.sh
```

Streams `git archive HEAD` straight into a native `docker build` on the VM
(arm64, no cross-compilation), writes the env file, and replaces the running
container (`--restart unless-stopped`, published only on
`127.0.0.1:3000` — never on a public interface; the tunnel is what makes it
reachable). Health-checks `http://127.0.0.1:3000/api/health` over ssh before
declaring success.

Optional overrides: `ADMIN_VM_USER` (default `ubuntu`), `ADMIN_VM_KEY`
(default `~/.ssh/anas-admin.key`).

## Rollback

`deploy.sh` writes the previous image tag to `/opt/anasaq-admin/previous-image.txt`
on the VM before replacing the container. To roll back:

```sh
ssh -i ~/.ssh/anas-admin.key ubuntu@<vm-ip>
previous=$(cat /opt/anasaq-admin/previous-image.txt)
docker rm -f anasaq-admin
docker run -d --name anasaq-admin --restart unless-stopped \
  --env-file /etc/anasaq-admin.env -p 127.0.0.1:3000:3000 "$previous"
```

## Cloudflare Tunnel

One-time, in the Cloudflare dashboard: **Networking → Tunnels** → create a
tunnel → the dashboard shows an install command containing a one-time
connector token. Run that command on the VM yourself — it is not part of
`setup.sh`, because the token is generated per-tunnel in the dashboard and
should not sit in a script. Then add a public hostname route:
`admin.anas.studio` → `http://localhost:3000`.

## Oracle's idle-reclamation rule

From `PLANS/ISSUES.md` I19: instances "may be reclaimed" if, over 7 days,
p95 CPU, network and (A1 only) memory are all below 20%. A solo-owner admin
with infrequent logins can plausibly sit under that for a week. Nothing here
works around it — memory will be right-sized (the 8 GB swap figure in
`setup.sh` is a starting point, not a measurement) once a real build and a
week of real admin traffic have been observed on the VM.
