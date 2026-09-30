# Privacy data map and request runbook (P06, I31)

What personal data the system holds today, why, who can read it and how long it stays, then how a request to see, correct or delete it is handled. Buyers are guests (D08). P07 stores their contact and delivery details when a checkout hold is created; P08 adds payments. The buyer erase function and its tests come with P08 and P10, so the buyer sections below are prerequisites, not passed checks (WORK-PACKAGES P06).

## The data map

| Where | What | Why | Who can read it | How long |
|---|---|---|---|---|
| `public.contacts` | A visitor's name, email, message, the submission key and the policy revision | The durable copy behind the owner's email notice, so an email outage loses nothing (D31) | No API role, the owner included; only the `contact` and `outbox` functions (`service_role`) | 90 days after its notice first reached a staff mailbox (D36), then deleted by the daily `contacts-purge` job. A message whose notice has not reached anyone yet is kept until one does. |
| The owner's mailbox (D31) | Every contact notice: name, email, message | Anas reads and answers messages there | Anas | His mailbox's own retention; outside the system |
| `finance.email_outbox` | Staff recipient addresses, a `contactId` reference, delivery status | Sending and retrying notices | Owner and operations see the rows that need attention | A contact's notice rows are deleted with the contact (D36) |
| `finance.email_delivery_events`, `finance.email_suppressions` | The recipient as a sha256 hash, event type, redacted evidence | Delivery tracking; never mailing a bounced or complaining address again | No API role | Kept; a suppression must outlive the message |
| `finance.rate_limits` | A salted hash of the visitor's IP and an unsalted sha256 of their email, per window (I34 residual) | Throttling the contact form and checkout (`checkout:*`, `checkout-quote:ip`) | No API role | Purged after 2 days (`rate-limits-purge`) |
| `public.customers` | A buyer's email, name and phone | One profile per buyer email, written by checkout | Owner and operations (the owner may edit name and phone) | Deleted by the daily `buyer-retention` job once it has no order and has not changed for 90 days (D42) |
| `finance.orders`, `finance.order_items` | The order's contact snapshot (name, email, phone, city, address), its items, the signed edition's dedication text, and a sha256 of the email | The order and its hold | No API role; only the `checkout` function | An expired or cancelled hold, with its items, reservations and coupon use, is deleted 90 days after it ended (D42, `finance.buyer_retention_purge`); paid orders (P08) keep the accounting retention E08 sets |
| A buyer's browser | The cart (`localStorage['anasaq:cart:v1']`: variant ids, quantities, schema version); in `sessionStorage`: dedications, the city and coupon, the create idempotency key with a digest of the request, and the order access token | The cart and cancelling a held order | The visitor | Until cleared; the `sessionStorage` items go with the tab |
| `auth.users` and the other `auth` tables | Staff email, sign-in history, sessions, TOTP factors | Staff sign-in (D08: staff are the only Auth users) | Supabase Auth; the owner sees names and roles in the team screen | While the person is staff; see "A departed staff member" |
| `auth.audit_log_entries` | Each staff sign-in event, with the staff member's id and email | Supabase Auth's own log | No API role | Kept by Supabase Auth |
| `public.staff` | Display name, role, active flag | Who may do what | Owner (team screen) | While the person is staff |
| `public.audit_events` | The acting staff member's id, the action and entity ids. Summaries hold roles, versions and flags only, never an email or a name. | The append-only change log (C23) | Owner | Kept; append-only by trigger |
| `public.media.created_by`, `public.content_versions.author`, `finance.commerce_settings.approved_by` | A staff member's id | Who uploaded, wrote or approved | Owner and editors | With the record |
| Backups (D35) | Everything above, as of each backup's date, encrypted | Recovery | Anas, with his passphrase | Until Anas deletes the file |
| Providers | Resend keeps sent-email data 30 days on the Free plan; Supabase keeps its platform logs per plan | Operating the service | The provider | The provider's policy |

Once E08 approves the privacy text (Anas approves it, and it must state the 90-day period), the contact form links it and records its revision; until then no link is shown and `contacts.policy_revision` stays null.

## Handling a request

**Verify the person first.** A visitor proves they own the address by writing from it, or by answering a message sent to it. A staff member is verified by the owner. Record the request, the check and the outcome in the deletion ledger (below) when anything is deleted.

**Where to run the SQL.** In the Supabase dashboard's SQL editor, or `supabase db query --linked "<sql>"`. The erase functions have no API grants, so nothing in the app can call them.

### A contact-form visitor

- **See or export:** `select id, name, email, message, created_at from public.contacts where email = lower(btrim('<address>'));`. Send the rows back to that address. Their notices are also in the owner's mailbox.
- **Correct:** update the matching rows by `id`.
- **Delete:** list the ids with the query above, then `select public.privacy_erase_contacts(array['<id>', ...]::uuid[]);`. It deletes those messages and any notice still waiting to be sent for them; sent outbox rows keep only a dangling `contactId` and the staff recipient. Anas deletes the notices from his mailbox himself. The rate-limit hashes expire within 2 days. Add the call to the deletion ledger.

### A departed staff member

1. Revoke them in the team screen (built: `active = false`, and Supabase Auth bans the user). Add the revoke to the deletion ledger as a line `revoke <user id>`: a restore brings the member back active and unbanned, and the team screen has no SQL call to record.
2. If they ask for erasure: `select public.privacy_erase_staff('<user id>');`. It refuses an active member. It replaces their email in `auth.users` with `erased-<id>@erased.invalid`, clears their Auth metadata and pending address changes, deletes their identities, sessions, refresh tokens, TOTP factors, one-time tokens and the Auth log of their own actions, puts the placeholder in place of their address in the Auth log entries about them (the owner's invite, the ban) and on sent notices addressed to them, drops unsent ones, and renames their staff row «موظف سابق». The Auth user itself stays, because deleting it would rewrite `audit_events.actor`, which the append-only trigger refuses (I31). The audit history keeps their id, which no longer leads to a name or an address.
3. Add the call to the deletion ledger.

### A buyer (P07, P08)

Buyers are guests (D08): a buyer request touches customers and orders only, never `auth.users`. Legally required accounting records are kept with the reason and period recorded. P08 and P10 add the buyer erase function and its tests (the tables exist since P07).

## The deletion ledger and restores

The ledger is a plain text file next to the backups, `ANASAQ-backups/deletion-ledger.txt` on Anas's machine, outside every backup, so restoring an older backup cannot roll it back (DATA-AND-SECURITY). Each line is a date and either the exact function call that was run or `revoke <user id>` (a team-screen revoke), identifiers only, never the erased content. After any restore, and before the site reopens, first re-revoke in the team screen every member a `revoke` line lists (`privacy_erase_staff` refuses an active member, and a restored older backup has them active again), then run every function-call line again: both functions are safe to repeat.

Backup files made before a deletion still hold the erased data until Anas deletes those files (D35 sets no automatic expiry). Say so in the answer to the person; do not promise erasure from every backup at once.
