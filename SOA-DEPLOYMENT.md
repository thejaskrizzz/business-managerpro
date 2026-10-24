# SOA settlement and PDF deployment

The code changes do not migrate or repair existing records. Do not run settlement
against production as a deployment smoke test.

## Database requirement

SOA credit application now requires MongoDB transactions (a replica set or sharded
deployment). A standalone MongoDB server is deliberately rejected without a
nontransactional fallback. Confirm the deployment supports transactions before
enabling settlement. Validate concurrent requests and rollback on a disposable
replica-set database before production rollout.

Settlement updates credit balances, redemption history, and invoice settlement
fields only. It does not invoke save hooks that recalculate historical item totals,
taxes, or cash payments. Numbered invoices are included regardless of their status;
only cancelled invoices are excluded. Allocation is FIFO across all issued invoices
for the customer, not just the preview period.

## PDF runtime

SOA now uses the installed Puppeteer version directly. HTML is never returned as a
successful PDF download. Rendering failure returns HTTP 503 and logs its cause.
Other document generators retain their existing behavior.

On the API host, under the same service account/environment as Node:

1. Inspect the `SOA PDF generation failed` and Puppeteer launch logs.
2. Ensure the locked backend dependencies and Puppeteer's matching Chrome are
   installed. If deployment skips install scripts, provision Chrome explicitly
   with `npx puppeteer browsers install chrome` from the backend directory.
3. Alternatively configure `PUPPETEER_EXECUTABLE_PATH` to a compatible installed
   browser executable. Ensure the service account can execute it and write to its
   temporary/cache directories.
4. On Linux, run `ldd /actual/path/to/chrome` and inspect missing dependencies.
   Install packages appropriate to the host distribution; do not assume every
   distribution uses the same package names.
5. Generate a PDF with synthetic customer/invoice data, verify its `%PDF-` header,
   and visually inspect it before deploying. No database is needed for this check.

Official browser troubleshooting: https://pptr.dev/troubleshooting

## Statement meaning

This is a current-balance view of issued invoices created within the selected
period, not an historical as-of ledger with an opening balance. Credit-note rows
are informational. The running invoice balance excludes unredeemed wallet credit;
the summary deducts available wallet credit once when enabled. Previewing does not
consume credit. Expired credits are excluded from available balances.

## Local checks

Run `node --test tests/soa.test.js` for isolated backend regression checks. These use
mocked models/sessions and never connect to MongoDB; they are not a substitute for
replica-set transaction integration tests. Compile the frontend from
`models/royalserve-frontend` with `npx tsc --noEmit`.
