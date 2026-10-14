# OSuite

Business management software for Indian SMBs: a Windows desktop app (with optional cloud hosting) plus a licensing/billing admin service.

## Layout

| Path | What it is |
|---|---|
| `packages/kernel` | Model metadata (`defineModel`), validation built from it, shared API types, India GST data, and the GST engine (`computeGst`, financial year, amount in words) used identically by server and UI |
| `packages/license` | Ed25519-signed licence tokens: sign, verify, grace/read-only evaluation |
| `packages/server-kit` | Server-only helpers shared by both backends: scrypt passwords, session tokens, Postgres error unwrapping |
| `packages/ui` | Shared theme (`theme.css`: tokens, Tailwind utilities, dark mode) and the brand mark |
| `apps/server` | Product server (Fastify + Drizzle + PostgreSQL). Generic CRUD for every model, auth, append-only hash-chained audit log, licence enforcement, serves the web UI |
| `apps/web` | React UI: ledger-style lists, side record panel, Ctrl+K command palette, setup/activation flows |
| `apps/admin-api` | Licensing & billing API for Coolify: plans, customers, licences, activations, trials, check-ins, Razorpay webhooks, staff accounts and an admin action log. Serves the admin web UI |
| `apps/admin-web` | Admin panel: revenue overview, renewals due, licences, customers, plans, team |
| `apps/desktop` | Tauri 2 shell: runs the server as a sidecar exe with an embedded PostgreSQL |
| `e2e/` | Browser and API suites (product, admin panel, invoices) run by `pnpm e2e`; browsers use the installed Microsoft Edge |

Adding a business object = one `defineModel` in a module under `apps/server/src/modules/`, then `pnpm --filter @osuite/server db:generate`. Tables, validation, API, list and form UI, search, history and audit come from the definition. Server-only rules go in the module's `hooks.ts`.

Documents (see `modules/sales` invoices and `modules/purchase` bills, both built from `modules/gst-document.ts`) add:
- a `lines` field pointing at a child model; lines are saved as a set with their parent, edited in a keyboard-driven grid, and cannot be written directly;
- `readonly` fields filled by the `compute` hook (e.g. totals), recomputed on every save;
- `states` (which states are editable) and `actions` (buttons such as Post/Cancel) implemented in `hooks.actions`, run in one audited transaction;
- many2one `fill` (pick a product, get its price/HSN/GST), many2one `filter` (vendor pickers only offer `isVendor` contacts) and `default: 'today'` dates;
- `gst: { placeOfSupplyField, supplierStateField? }`: intra-state (CGST+SGST) when the supplier's state equals the place of supply; the supplier is the company on sales and the vendor on bills (`isIntraState` in the kernel, used by server and UI);
- gap-free numbering per Indian financial year via `nextDocumentNumber(tx, 'INV', date)` -> `INV/26-27/0001`.

Other model options: `readonly: true` for data only server logic writes (ledgers, balances: the API returns 403 and the UI shows them as reports), `uniqueTogether` for composite unique keys, and many2one fields in `searchFields` (lists match the linked record's name, e.g. invoices by customer).

Inventory (`modules/stock`): posting a bill brings goods in at net cost (after discount, before GST); posting an invoice takes them out at weighted-average cost; adjustments cover opening stock, counts and write-offs. Every change is a row in the immutable stock ledger (`stock.move`) and updates stock on hand (`stock.quant`); cancelling reverses at the original cost. Posting that would take stock below zero is refused with the shortage listed, unless the company allows negative stock. Valuation maths lives in `packages/kernel/src/stock.ts`.

Payments (`modules/account`): one `account.payment` model shown as *Payments received* (Sales) and *Payments made* (Purchases) through menu `filter`s. Allocation lines settle posted invoices (receipts) or bills (vendor payments); "Allocate to oldest dues" fills them FIFO and anything left is an advance. Posting updates each document's `amountPaid` / `amountDue` / `paymentState` and refuses over-payment or another party's document; cancelling reverses it, and a document with payments cannot be cancelled. `/api/reports/ageing?direction=inbound|outbound` powers the Receivables and Payables pages (menu `path`). Fields can declare `visibleWhen` (also against the parent document for line columns) and selection fields `badge`.

Accounting (`modules/account`): a seeded Indian chart of accounts (`account.account`; system accounts carry a `key` such as `receivable` or `output_cgst`) and an automatic, read-only double-entry journal (`account.entry` / `account.entry_line`). `journal.ts` builds the entry for each document: invoices (debtors / sales, output GST, round off, plus COGS against stock at the stock ledger's value), bills (stock at the stock ledger's value, purchases for the rest, input GST / creditors), payments (cash or bank / debtors or creditors) and stock adjustments (stock / stock gain-loss, or opening balance equity). Unbalanced entries abort the posting; cancellations post a mirror entry dated the day of cancellation. `reports.ts` serves the trial balance, P&L, balance sheet, and GSTR-3B / GSTR-1 (B2B, B2CL above ₹1 lakh, B2CS, CDNR/CDNUR, HSN net of credit notes, documents) computed from posted invoices, bills and notes.

Credit notes (`sales.credit_note`) and debit notes (`purchase.debit_note`) are GST documents against a posted invoice or bill (`appliesTo` in `gst-document.ts`): "Copy items" fills them from the original; returns move goods at the original document's stock cost; posting reverses the sale/purchase in the journal, settles the original's balance due and keeps any rest as party credit (shown as an advance in Receivables/Payables); notes against one document cannot exceed it. Manual journals (`account.manual`) post free-form balanced entries to any account; the form shows a live debit/credit balance.

Bank reconciliation (`modules/account/bank.ts`, page `/bank`): bank accounts (`account.bank_account`) each book to a ledger account, and non-cash payments post to their bank's ledger. Statement CSVs are parsed in the browser (`packages/kernel/src/bank.ts`: header detection for common Indian bank exports, Indian date/amount formats) and imported with per-line fingerprints, so overlapping statements are not doubled. Each statement line is matched to an unmatched journal item on the bank's ledger with the same amount within ±10 days; a UTR or document number found in the bank narration ranks first, and auto-match only takes unambiguous matches. Lines the books lack (charges, interest) can be booked from the statement. The summary compares the bank's closing balance with the book balance and lists book items not yet on the bank. Match, unmatch and booking are audited.

Ledger and day book (`modules/account/ledger.ts`, pages `/reports/ledger` and `/reports/day-book`): the ledger shows one account's journal items for a period with the opening balance carried in, a running Dr/Cr balance and the other side of each entry; each voucher links to its source document. Picking a party instead (or **Statement** on a contact) gives their statement of account across debtors and creditors, which prints on A4 at `/print/statement/:partnerId`. Accounts on the trial balance, P&L and balance sheet drill into their ledger. The day book lists every journal entry in a period with its lines.

Credits (`modules/account/credits.ts`): unapplied advances and posted credit/debit notes count as a party's available credit. `Apply ₹X credit` on a posted invoice or bill (or `Apply` on Receivables / Payables, which pays the oldest dues first) records settlements against that credit; cancelling either side reverses its settlements.

Year-end closing (`modules/account/closing.ts`, page `/closing`, admins only): a financial year that has ended and has no drafts dated in it can be closed. Closing posts a journal moving the year's income and expense balances to Reserves & surplus (account 3200) and locks the year: no journal can be posted with a date on or before its last day. Only the most recent closing can be reopened, which reverses its journal and lifts the lock.

Dashboard (`modules/account/dashboard.ts`, the home page): sales today / this month (compared with the same days last month) / this financial year, net of credit notes; what customers owe and how much is overdue; what you owe vendors; cash and bank balances; this month's GST output less input credit; profit for the year; a 12-month sales and purchases chart; the most overdue invoices; top customers; products at or below their reorder level (`reorderLevel` on goods) or in negative stock; and drafts waiting to be posted. Each figure links to the report or list behind it.

Backups (`services/backup.ts`, page Settings → Backups, admins only): `pg_dump` custom-format files (`.osbak`, session data excluded) in `<data dir>/backups`, taken on demand and automatically once a day (checked hourly; the last 10 daily backups are kept by default), optionally copied to a second folder such as a USB disk or a synced OneDrive folder. Settings live in `<data dir>/backup.json`. Backups can be downloaded, and a downloaded file can be uploaded and restored (it must contain OSuite's tables). A restore never touches live data until the backup has been checked: it is restored into a scratch database, which must have no more migrations than this build and an intact audit chain; then the current data is backed up (kind "before-restore", last 3 kept), other API calls get 503 while the databases are swapped by rename, migrations run, and the restore is written to the audit log. Everyone signs in again afterwards. The tools come from `OSUITE_PG_BIN` (the bundled PostgreSQL in the desktop app), `PG_BIN`, or the PostgreSQL 17 install in dev; without them the page says backups are unavailable.

## Development (Windows)

Prerequisites: Node 22+, pnpm, PostgreSQL 17 binaries (`C:\Program Files\PostgreSQL\17`, or set `PG_BIN`).

```sh
pnpm install
pnpm db:start          # private dev cluster on 127.0.0.1:54329 (no password), creates osuite + osuite_admin
pnpm keys:dev          # dev licence signing keys (keys/ is git-ignored)
pnpm dev:admin         # licensing API  -> http://127.0.0.1:47900
pnpm dev:admin-web     # admin panel with hot reload -> http://localhost:5174
pnpm dev:server        # product server -> http://127.0.0.1:47800
pnpm dev:web           # UI with hot reload -> http://localhost:5173
```

In development the admin API creates the owner account `owner@osuite.local` / `owner-password` on first start. In production set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` (see `apps/admin-api/.env.example`); staff sessions are HttpOnly, SameSite=Strict cookies.

Licence checks are on by default; the first-run screens offer a 14-day trial (served by the local admin API). Set `OSUITE_LICENSE=off` on the server to skip them. `scripts/reset-dev.ps1` wipes both databases for a fresh install.

Checks: `pnpm test` (unit), `pnpm typecheck`, and `pnpm e2e`, which builds both UIs and runs every suite in `e2e/` (product, admin panel, invoices, purchases, company settings, inventory, payments, accounting, notes, journals, bank reconciliation, credits, year-end closing, the ledger, backup/restore and the dashboard, plus a grid stress test) each against freshly reset databases (`node scripts/run-e2e.mjs .data/e2e-shots invoice` runs only matching suites), saving screenshots to `.data/e2e-shots`. It stops the dev services on ports 47800/47900 and wipes the dev databases.

## Building

```sh
pnpm --filter @osuite/web build
pnpm --filter @osuite/server build             # apps/server/dist: single-file bundle + migrations + web
node scripts/package-sidecar.mjs --with-postgres # Node SEA exe + resources for Tauri
pnpm --filter @osuite/desktop build             # NSIS installer (needs Rust + MSVC build tools)
docker build -f apps/admin-api/Dockerfile -t osuite-admin-api .   # API + admin panel in one image
```

Release builds must replace `apps/server/src/services/license-pubkey.ts` with the production public key and code-sign the sidecar and installer.

## Licensing model

- Activation binds a licence to a machine fingerprint; the admin API returns a signed token the app verifies offline.
- The app checks in every 6 hours; each check-in extends `refreshBy` by 14 days and picks up renewals.
- After the paid period or the check-in deadline, there are 7 days of grace, then the install becomes **read-only** (never locked out of its data).
- Razorpay `subscription.charged` webhooks extend the paid period (or, for a trial, switch it to the plan in the subscription's `plan_id`/`cycle` notes); webhook events are stored idempotently. Revoked licences are never revived by payment events.
- Staff renewals in the admin panel extend the period without changing the billing cycle; plan and cycle changes go through "Change plan" / "Convert to paid", which keep the key and machine binding.
