# Billing operations

## Account plans and shared usage

Personal settings owns Billing, including the account plan, payments, shared usage balance, and account overage consent and cap. A team's Usage & limits page shows its own usage and stricter team spending limits. Only the account payer can manage the plan or view usage from sibling teams. Organization admins cannot open the payer's customer portal.

`user.id` is the canonical account payer and production external customer identity. `organization.billingOwnerUserId` records explicit funding consent for that organization. Every admission verifies that the payer still has an owner membership. One allowance covers all organizations explicitly funded by that account. Admission and settlement lock the payer before the originating organization. Reservations and ledger events freeze the payer, source organization, destination, subscription, and admitted period.

Live billing uses account subscriptions only. There is no team-plan fallback, legacy plan adoption action, or automatic choice of another owner. A new payer must personally accept funding through the account takeover flow. The current payer cannot leave, be removed, or lose their owner role before funding transfers. Account overage starts disabled. Both the account consent and cap and any stricter team consent and cap apply.

Historical team subscriptions, snapshots, and reporting destinations remain accounting records. Read-only compatibility decoders preserve queued work and original reporting contracts. They do not activate a legacy plan, pool old team allowances, or redirect historical charges to a new payer. Keep the historical records after the account cutover.

### Configure the account catalog

Use separate private account Managed and Pro products and an account-overage meter in production and sandbox. Fixed monthly prices are 1500 cents for Managed and 2500 cents for Pro. The meter matches `account-usage`, sums `metadata.billableMicroCents`, and charges a flat `0.000001` cents per microcent. Do not attach the old meter-credit benefits. The local ledger already applies the included allowance, so the meter receives only customer-billable overage. Historical credit events retain their original wire contract and destination.

Stripe merchant activation remains deferred until the user supplies the pending tax ID. Catalog configuration and entitlement grants do not establish payment or renewal capability. Do not invent tax details, enable capabilities by assumption, or manufacture renewal dates.

### Cut over existing founder billing

Use the protected deployment and account administration workflows below. Before account-only writers publish, verify the exact authorized founder's permanent unlimited override and explicit organization funding. Active overrides resolve before provider reconciliation, so unavailable renewal capability does not remove authorized unlimited access.

Drain or preserve outstanding provider calls, mail submissions, and reporting obligations. Reconcile ambiguous provider attempts separately. Retire old subscriptions through the explicitly authorized provider operation. Apply migrations and deploy every billing writer together, including web, background Workers, receipt processing, and mail sending. The bootstrap grants access only. It does not drain work or cancel subscriptions. Verify the deployed application and remove the temporary bootstrap variables afterward.

Gmail connection slots remain per team and inherit the funding payer's plan. Monetary usage is pooled across the account.

Unlimited accounts retain the full usage overview for UTC calendar months. Their recorded costs have no usage cap or new usage charges. Settled, nonfinancial AI request records retain each actual cost once without creating a billing ledger event or reporting it to the payment provider. The overview combines recorded costs with historical source records and removes overlapping measurements. Historical chat and memory costs that were never persisted remain unavailable.

## Gmail connections and live updates

All plans receive Gmail live updates. Free teams can connect 5 Gmail accounts, Managed teams 25, and Pro teams 100. The allowance is shared across team members; each Gmail mailbox remains private to its owner. Managed mailboxes do not consume Gmail slots. Limits are defined in `packages/billing/src/plans.ts` and enforced at OAuth start, transactionally at OAuth completion, and when moving a mailbox into a team.

Concurrent connections lock the destination team before counting and writing. Reconnecting an existing mailbox remains allowed after a downgrade; additions and incoming moves stop at the new limit without deleting existing mail. Paid Gmail AI assistance retains its separate entitlement. Watch renewal and notification ingestion do not require that entitlement.

Ordinary paid access requires a confirmed active or trialing subscription with a future period end. An active status alone does not extend an overdue period. Failed reconciliation and unconfirmed renewal deny paid access. Scheduled cancellation retains access only until the confirmed end. Existing Gmail connections and live updates remain subject to the separate rules above. A valid unlimited override is resolved before provider reconciliation.

Persisted billing snapshots keep their original subscription and admitted period. Historical work does not acquire the current account's allowance or reporting destination. Closed or unconfirmed periods are deferred for reconciliation rather than replayed into a later invoice cycle.

## Production webhook setup

Production configuration, secrets, migrations, and deployments require explicit authorization. Use the protected production workflow, and never copy production credentials into `.env.local`.

Production SST state and secrets are in AWS `eu-central-1`. The production provider is pinned to that region in `sst.config.ts`; local development can still use a different region. A successful secret read from another region does not verify production configuration. For older worktrees on this workstation, use `quieter-sst -Stage production` from the shared PowerShell tooling to select the correct region.

Every runtime that reads billing uses `billingEnvironment` from `infra/runtime.ts`, including the web app, Gmail workers, action worker, and receipt processor. Production always sets `QUIETER_DEPLOYMENT_ENV=production` and `POLAR_SANDBOX=false`. Do not infer the billing environment from a Worker's `NODE_ENV`. The September 5 Sentry investigation found production Gmail workers calling the sandbox API with a production token. Their failed reconciliations also blocked the web billing overview through the shared subscription record. After deploying the corrected environment to all writers, allow the five-minute reconciliation retry window and verify both billing and Gmail sync recover.

In the production Polar organization, inspect the existing endpoint before creating another one. Wait for the endpoint list to finish loading; its initial empty state is not evidence that no endpoint exists. Configure the endpoint for `https://quieter.email/api/auth/polar/webhooks`. Subscribe to:

- `subscription.created`
- `subscription.updated`
- `subscription.active`
- `subscription.canceled`
- `subscription.uncanceled`
- `subscription.past_due`
- `subscription.revoked`
- `subscription.paused` and `subscription.resumed`, when available

If an endpoint is disabled, inspect its delivery responses before re-enabling it. A signature mismatch requires matching the existing endpoint secret to the deployed receiver; resetting only one side will not fix delivery. Subscribe only to events supported by the deployed receiver.

Store the endpoint's signing secret in the production SST secret `PolarWebhookSecret`. The runtime reads it as `POLAR_WEBHOOK_SECRET` through `@quieter/env`. `PolarAccessToken` is separately required for checkout, the customer portal, and reconciliation. Receiving signed webhooks does not require an API token.

Deploy through `.github/workflows/sst-deploy.yml`, which applies migrations before publishing the application. Verify a signed delivery receives HTTP 200 and updates the correct payer account's billing state. Unsigned, tampered, and stale signatures must be rejected. A missing signing secret returns 404. Synchronization failures return 500 so Polar retries; monitor failed deliveries and Sentry, and re-enable an endpoint if Polar has disabled it after repeated failures.

The receiver verifies both Standard Webhooks signatures and Polar's older scheme. [Polar switches new and reset secrets on September 8, 2026](https://polar.sh/docs/integrate/webhooks/delivery). Older secrets use the UTF-8 bytes of the entire secret as the signing key. New secrets use the decoded Standard Webhooks key. Keep both verification paths while either kind can be configured, and always verify before parsing or applying subscription data.

The private site-password gate already exempts this exact endpoint. It must remain reachable without a browser session; webhook signatures provide authentication.

## Active subscription with an overdue renewal

Check the provider's subscription detail page, attached discount, order history, and merchant review status before creating another checkout. A 100% discount can be valid forever while the subscription's billing cycle remains stalled.

Polar's [organization capabilities](https://github.com/polarsource/polar/blob/main/server/polar/models/organization.py) disable subscription renewals in the initial `CREATED` state. Its [order service](https://github.com/polarsource/polar/blob/main/server/polar/order/service.py) checks that capability for renewal payments. An unfinished merchant review can leave monthly billing blocked while a subscription still appears active, including the zero-total subscriptions observed here. Confirm the account's actual capability through the organization API before attributing other stalled renewals to this restriction.

Complete the merchant setup or ask Polar support to enable the appropriate account capabilities. For access independent of billing, use an explicitly authorized entitlement grant through the protected account workflow. Prefer a fixed expiry unless permanent access was explicitly authorized. Do not disable production billing enforcement, manufacture renewal dates, or repeatedly create subscriptions. Existing entitlement overrides belong to a billing owner and can affect more than one team owned by that user; review that scope before granting one.

For temporary recovery of an existing 100%-discount test subscription, Polar's **Update Subscription > Billing Period** control can grant free time by extending the period end. Confirm the discount before applying this change. This does not fix automatic renewal capability, advance the period start, or reset usage credits.

After Polar corrects the period, the webhook or the next billing reconciliation restores access automatically. An active subscription whose period is still overdue is shown as an unconfirmed renewal, and checkout cannot create a duplicate. Failed reconciliation remains distinguishable from an ended subscription. Scheduled cancellation keeps access until the period ends; immediate revocation and exhausted payment retries remove access.

## Usage accounting and recovery

Account usage is scoped to its frozen payer, provider subscription, and period start. A real renewal advances the start and begins a new allowance. Extending only the end retains usage and does not reset credit. For the same subscription and period start, synchronization retains the highest included allowance observed across plan changes. An upgrade can increase that period's allowance. A later downgrade does not claw it back or reset usage. A new period uses the current plan allowance.

The ledger separates three amounts. `costMicroCents` preserves measured retail usage cost. `chargeableCostMicroCents` is the customer-authorized portion, including included usage. `billableCostMicroCents` is only the overage owed after the allowance. The merchant absorbs cost above authorization, consent, or hard caps. Historical null chargeable values decode to historical cost. New account records populate the amounts and frozen accounting fields explicitly.

AI, outgoing mail, and unavoidable incoming settlement use the same budget policy under payer-first locks. Outstanding commitments consume allowance and cap headroom. A reservation freezes its maximum authorization. Settlement cannot increase that authorization and rechecks current account and team limits, so reducing a cap can reduce later customer liability. Only billable overage enters the account meter. Actual expense remains in the local ledger. Immediate reporting and retries share the same period eligibility checks.

PostgreSQL returns `sum(bigint)` as a numeric string. Aggregate expressions must use a runtime number decoder before arithmetic. A TypeScript `sql<number>` annotation alone does not convert the value. Without decoding, adding a new charge concatenates the previous sum and the charge, creating invalid overage amounts and potentially rejecting mail below the included balance.

### Historical September incident

The September 5, 2026 production investigation recorded the following historical state. These findings do not establish today's provider or deployment state:

- Polar's organization was `created`, with `subscription_renewals: false`. Its four orders are all zero-total subscription creations; there are no renewal orders. The two Pro subscriptions then recorded ended at October 4, 00:00 Europe/Berlin, while their starts remain unchanged.
- The endpoint secret differs from the actual Frankfurt SST secret. A signed invalid payload using the Frankfurt secret passes the deployed signature check and reaches payload validation. The same probe using the endpoint secret fails signature verification. An unrelated `us-east-1` SST secret namespace matches the endpoint and caused the earlier false-positive comparison. The endpoint was disabled.
- The local ledger contained events with stored overage exceeding their entire actual cost. Some were marked reported to Polar, but the metered `credits` property uses actual cost; the inflated value is separate metadata. No paid renewal order was found. Customer-specific counts and amounts are recorded in the private verification handoff.
- There was an unreported usage backlog. The actual production token can read subscriptions and accepts an empty event ingestion batch. That scope check does not explain the historical backlog; do not assume all outstanding events have reached Polar.

The code fix prevents new invalid amounts after release; it does not rewrite existing ledger records. Before repairing production, use the protected workflow to preserve a snapshot of affected rows and recompute overage from actual costs and the applicable subscription periods and allowances. Do not subtract the displayed inflated total from a customer's balance or change actual cost, event identity, or event timestamps. Recheck rows after stopping the faulty writer, since counts can continue increasing before release.

The `Repair billing credit overage` workflow runs only from protected main after that exact revision has deployed successfully. It locks the ledger while saving the affected amounts to an encrypted object in the production SST state bucket, then clears invalid overage only for affected organizations whose entire lifetime usage is below the smallest paid allowance. It refuses larger balances and rolls back if the snapshot fails. This is a bounded repair for the observed corruption, not a general historical invoice recalculation. Its database integration tests cover rollback, valid overage preservation, idempotence, and the allowance guard.

After that repair, reconcile the local ledger against Polar events by external ID. Polar events are immutable, and duplicate external IDs do not overwrite incorrect metadata. The retry path preserves original event timestamps, removes duplicate subscription joins, and excludes ended subscription periods. Polar bills late events in the cycle when they are received, regardless of the supplied timestamp. Do not automatically replay usage from closed cycles. See [event ingestion](https://polar.sh/docs/features/usage-based-billing/event-ingestion).

For webhook rotation, keep the endpoint disabled while resetting its secret. Transfer the new value to the production GitHub environment secret `POLAR_WEBHOOK_SECRET`. The protected SST deployment copies it into the linked `PolarWebhookSecret` resource. Verify the deployed signature check before enabling delivery, then verify a real subscription event. Never print the secret or reuse an exposed value.

## AI admission and interrupted requests

Every metered AI provider call creates an `aiCreditReservation` before sending the request. The operation stores the authorizing account, organization, billing period, usage kind, and admission timestamp. Mailbox moves, deletion, membership changes, and later subscription changes do not change that charge. SDK retries and tool-loop turns each reserve separately, and a completed turn settles before the next turn or nested tool work starts.

The provider endpoints do not all support a monetary request cap. AI reserves the available authorization under the payer and organization locks. Authorization includes enabled overage within the account and team caps. A null maximum means explicitly uncapped overage. Concurrent AI admission rejects while another hold is active, and outbound mail respects the same commitments. Existing mail holds reduce AI headroom. The provider may still incur more expense than authorized. Settlement records that expense, caps customer liability, and leaves the excess with the merchant.

Known provider rejection releases its hold. Known zero-cost completion also restores admission. A timeout, cancellation without final usage, missing cost, or process crash retains its hold. Do not release those holds based on elapsed time. Confirm the provider outcome before using the single-reservation recovery procedure below, or obtain named merchant authorization to accept all provider liability for that operation. Production resolution requires the protected operational workflow and explicit authorization. Provider callbacks keep using the existing settlement and release functions.

Actual cost is persisted before ledger reconciliation. `vp run billing:sync-credit-usage-polar` first calls `reconcileAiCreditReservations` for completed holds, then retries the existing usage-event reporting. Reconciliation and repeated settlements use the same ledger dedupe key. Unknown-cost provider lookups use bounded batches ordered by `lastReconciledAt`, with never-attempted reservations first. Each batch advances its retry order in a short row-locked transaction before provider I/O, so unavailable generations cannot indefinitely block other organizations. Concurrent runs skip locked rows; overlapping provider reads remain possible after the claim commits and remain safe through guarded cost writes and idempotent settlement. The nullable retry timestamp migration must precede application deployment. Unknown-outcome holds remain reserved for inspection. Inspect `aiCreditReservation` rows with `status = 'reserved'`; a null `actualCostMicroCents` distinguishes an unconfirmed outcome from a known cost awaiting reconciliation.

Apply the additive reservation-table migration before deploying the application. Drain pre-release provider calls and pending usage-reporting jobs during a coordinated rollout. The legacy reporting path remains for historical operations without reservation groups; new groups are already accounted at the provider boundary. Retire that compatibility path only after historical reporting has drained.

## Close an account or organization safely

Deletion first records a closing state under the payer and organization locks. New usage admission stops while existing work can settle or recover. Shared teams must transfer funding to an accepting owner before the payer deletes their account. Organization deletion and account deletion refuse unresolved AI holds, pending or ambiguous mail submissions, and positive unreported liability.

Account deletion also confirms provider subscriptions and pending checkout state. Scheduled cancellation is not completed cancellation. Provider failure leaves deletion blocked. Personal Billing retains subscription management while the account is closing so the payer can complete cancellation. Resolve financial work, then retry deletion. Do not clear closing flags, delete ledger rows, or grant access to bypass these checks. Financial payer IDs and immutable source attribution remain available after identity deletion.

Use the single-reservation procedure below for interrupted AI work. Use the deferred-liability procedure for an authorized waiver of never-attempted charges. Attempted or ambiguous provider reporting requires provider reconciliation before deletion can complete.

## Recover one interrupted AI reservation

Use `Recover AI credit reservation` in `.github/workflows/ai-credit-recovery.yml` after this revision has merged into protected `main` and that exact revision has deployed successfully. Run it with `--ref main`. Only a repository administrator can run inspection or recovery. The workflow checks the initiating and triggering actors' current repository permissions through GitHub before obtaining AWS credentials. A maintainer or writer is refused. The existing `production` environment restricts execution to protected branches; the job and deployed-revision checks further require `main`. Ref checks inside editable workflow YAML do not establish trust on their own. Administrator dispatch, incident evidence and exact reservation confirmation authorize one resolution. Independently reviewing the evidence before dispatch is recommended but is not an enforced environment approval gate. This procedure does not change environment or IAM settings.

The workflow checks administrator permission, current main and the latest successful production deployment before obtaining AWS credentials. It uses the existing production concurrency group and [SST shell resource links](https://sst.dev/docs/reference/cli/#shell). `DatabaseUrl` reaches `@quieter/env` through `configureServerEnv`. No database credential is placed in workflow inputs or ordinary environment configuration. The script makes no provider lookup, billing-provider call, or migration.

1. Obtain the reservation UUID and original organization ID from the restricted incident record. Inspect exactly that reservation. Replace the synthetic IDs below. The JSON is passed as one quoted argument.

   ```bash
   gh workflow run ai-credit-recovery.yml --ref main -f request='{"mode":"inspect","reservationId":"11111111-1111-4111-8111-111111111111","organizationId":"synthetic-team"}'
   ```

   Read the completed run log. It returns the admission time, original period, held and known actual cost in microcents, status, whether provider identity exists, and a SHA-256 `snapshot`. It omits account/customer identities, group identifiers, prompts, addresses and credentials. Inspection does not release funds. An unknown outcome remains held.

2. Stop or drain the originating request and establish its final provider outcome using restricted provider records. Cancellation, missing logs and elapsed time are insufficient evidence of non-execution. Use actual billed USD before the existing recovery fee for `actual-cost`, including zero for a confirmed zero-cost completion. Use `non-execution` only when authoritative records prove that no provider execution occurred. Non-execution refuses a persisted provider identity or actual cost. Automatic reconciliation remains the preferred path when final cost is already known.

   If no reliable outcome evidence exists, keep the hold unless the merchant explicitly accepts all provider liability for this one operation. Record the named authorization in the restricted incident system. Use `merchant-write-off` with an incident-safe `authorization` reference only for that decision. The provider expense remains unknown and may exceed the held balance. This resolution does not assert non-execution or zero provider cost. It refuses any persisted actual cost, including zero, and preserves any provider identity. It releases the hold with zero customer usage, without resetting credit or bypassing entitlements. Later provider evidence does not automatically recharge the customer.

3. Prepare a dry-run request using the returned snapshot. `evidence` and `reason` are restricted incident references, not message content or personal information. Values allow only letters, numbers, `_:/#.-`, from 3 to 200 characters. Keep detailed evidence in the restricted incident system. The production workflow supplies `operator` from the GitHub run and triggering actor, overriding any input value.

   ```json
   {
     "mode": "dry-run",
     "reservationId": "11111111-1111-4111-8111-111111111111",
     "organizationId": "synthetic-team",
     "expectedSnapshot": "COPY_INSPECTION_SNAPSHOT",
     "evidence": "incident:123-provider-export",
     "reason": "confirmed-provider-charge",
     "resolution": { "kind": "actual-cost", "costUsd": 0.01 }
   }
   ```

   Pass this JSON through the same `gh workflow run ... -f request='...'` command. A successful dry-run reports the resolution, customer charge and final status without changing admission or ledger state. For confirmed non-execution, replace `resolution` with `{"kind":"non-execution"}` and use the corresponding evidence and reason.

   For an authorized merchant write-off, the following dry-run uses synthetic IDs and incident references. Replace them and the snapshot with the reviewed values. `authorization` must identify the recorded named approval to accept all provider liability for this operation. It uses the same restricted reference format as `evidence`.

   ```bash
   gh workflow run ai-credit-recovery.yml --ref main -f request='{"mode":"dry-run","reservationId":"11111111-1111-4111-8111-111111111111","organizationId":"synthetic-team","expectedSnapshot":"COPY_INSPECTION_SNAPSHOT","evidence":"incident:123-unknown-provider-outcome","reason":"merchant-accepts-all-provider-liability","resolution":{"kind":"merchant-write-off","authorization":"incident:123-merchant-approval"}}'
   ```

   The write-off output reports `providerOutcome` as `unknown` and `customerChargeMicroCents` as zero. `releasedReservedCostMicroCents` reports the released hold separately. That amount does not cap the provider liability accepted by the merchant.

4. Obtain explicit authorization for this reservation and evidence. Submit the same request with `mode` set to `resolve`. For `actual-cost` or `non-execution`, set `confirmation` to `resolve:RESERVATION_UUID:SNAPSHOT`. For `merchant-write-off`, set it to `merchant-write-off:RESERVATION_UUID:SNAPSHOT` and retain the reviewed authorization reference. The workflow and command require an unchanged reservation, including its stored account, organization, period, provider metadata and cost. Any concurrent change fails closed. Inspect again and re-evaluate the evidence before resubmitting a changed request.

Resolution takes the organization lock before the reservation lock. It commits audit metadata, the original-period ledger entry and the terminal hold transition together. Confirmed non-execution writes a zero-cost audit entry and releases the hold. Confirmed actual cost uses the existing price conversion and settles the hold. A merchant write-off releases the hold and writes a zero-customer-usage audit entry with `recoveryProviderOutcome=unknown` and `recoveryMerchantAuthorization` set to the authorization reference. Its `actualCostMicroCents` stays null and its provider identity remains unchanged. Recovery audit references stay in the local ledger and are excluded from external billing metadata. Existing synchronization reports positive usage after commit, subject to the closed-period reporting rules above. Successful resolution restores AI and outbound mail admission when the account otherwise has available credit and access.

Identical command retries with the same snapshot, resolution, evidence, reason and operator return `already-resolved` without charging twice. Merchant write-off retries also require the same authorization and recorded unknown provider outcome. The production operator tag includes the run ID, so a new workflow run must inspect again and will refuse to resolve an already terminal reservation. A workflow rerun by the same administrator preserves its run ID and supports an exact retry. A conflicting cost, opposite outcome, changed audit reference or changed persisted state fails. Do not edit the ledger, account snapshot or reservation to bypass a refusal.

For local debugging, use only a disposable loopback database or an existing approved local database. Run `vp run @quieter/env#build` and `vp run @quieter/observability#build` before invoking the CLI. Node loads the observability package through its built default export, so a clean checkout requires both builds. The production recovery workflow and migration integration job perform these prerequisites. Provide the ignored local configuration and run `vp run env:doctor` after configuration changes. Run `vp exec node --env-file=.env.local scripts/ai-credit-recovery.ts 'JSON_COMMAND' --local`. Local dry-run and resolution requests must include an incident-safe `operator` reference. Local execution requires `QUIETER_DEPLOYMENT_ENV=local` and a loopback database; the command never silently selects production. The focused PostgreSQL suite uses only `quieter_migration_test` on loopback and synthetic data.

## Administer account access through protected main

Use `Administer account billing access` in `.github/workflows/billing-operations.yml` for an exact internal user ID. Inspection is the default and uses a read-only transaction. Account inspection without `event_id` returns booleans and counts, without email addresses, user IDs, organization IDs, reasons, or credentials. It reports the effective latest active override and whether the account is closing. An override applies to the payer account and therefore covers every organization explicitly funded by that account.

Only repository administrators can dispatch this operation. Both the original and triggering actors must still have administrator permission. The workflow requires current protected `main`, the `production` environment, and the same concurrency group as production deployments. The CLI reuses the migration target guard and refuses remote production execution outside the approved GitHub Actions context. It uses the existing production `DATABASE_MIGRATION_URL` secret only in its execution step. Do not copy that credential to local configuration or broaden database roles to bypass a refusal.

Inspect the exact target before granting access. Replace the synthetic ID below with the approved internal ID from restricted records.

```bash
gh workflow run billing-operations.yml --ref main -f action=inspect -f user_id=synthetic-user
```

An explicit grant requires a restricted authorization reference and exactly one duration choice. Use `permanent=true` only when permanent access was authorized. Otherwise provide a future ISO timestamp in `expires_at`. Neither an omitted duration nor both duration choices are accepted.

```bash
gh workflow run billing-operations.yml --ref main -f action=grant-unlimited -f user_id=synthetic-user -f reason=incident:approved-permanent-access -f permanent=true
gh workflow run billing-operations.yml --ref main -f action=grant-unlimited -f user_id=synthetic-user -f reason=incident:approved-temporary-access -f expires_at=2099-01-01T00:00:00Z
```

The grant takes the user lock before sorted affected organization locks. It refuses a closing account and atomically ensures one active Pro override. It revokes other active overrides and preserves their original reasons with the new audit entry. Expired or previously revoked history remains unchanged. A matching sole Pro override is retained on retry. A new duration replaces the prior active grant, with the old grant retained as revoked history. Audit entries retain the reason, GitHub actor, run URL and any explicitly accepted funding organization IDs. No provider subscription, renewal date, ledger amount, or provider capability changes.

For an explicitly authorized cutover only, `accept_unfunded_owned_organizations=true` accepts funding for organizations whose `billingOwnerUserId` is NULL and whose exact target user has an `owner` membership. It refuses a closing candidate and rechecks owner membership during the update. It never overwrites another payer, funds a non-owned organization, or chooses a replacement payer at runtime. Leave this option false for normal entitlement administration. Funding changes and their audit entry commit with the grant.

The account workflow has no entitlement revocation action. Temporary grants expire naturally. Revoking a permanent grant requires a separately reviewed protected operation, including its authorization and scope. Do not delete override history or change production data locally.

### Bootstrap before the first account-only deployment

The standalone workflow exists only after merge. To guarantee a named authorized account has permanent access before account-only writers publish, set the production GitHub environment variable `BILLING_BOOTSTRAP_USER_ID` to the verified internal user ID before merging the cutover. Set `BILLING_BOOTSTRAP_ACCEPT_FUNDING=true` only when accepting every currently unfunded organization owned by that exact user is also explicitly authorized. No identity is inferred from an email address or display name.

The deployment workflow invokes the same guarded CLI after migrations and before publishing writers. It uses an explicit permanent grant with an account-cutover audit reason and GitHub operator reference. A bootstrap failure stops publishing. Retries converge on the existing grant. This step does not retire old subscriptions or drain pending usage; complete the separately reviewed cutover procedure for those obligations.

After the successful deployment, use the standalone inspection workflow and verify the account in the application. Remove both bootstrap variables from the production GitHub environment. The persisted override continues to grant access after the variables are removed. Never retain bootstrap configuration as a permanent identity allowlist. Merchant activation and tax details remain a separate operation and must not be simulated to complete this bootstrap.

For local manual verification, use the approved `quieter_dev` configuration or a disposable loopback database, with synthetic users and organizations. Run `vp run @quieter/env#build`, then `vp exec node --env-file=.env.local packages/database/scripts/billing-account-admin.ts --user-id synthetic-user`. A local grant also requires `--operator local:restricted-reference`, `--reason`, and an explicit duration. Keep the configured database URL within the existing allowlist. Remove the synthetic overrides and settings before deleting fixture organizations and users. Financial records retain opaque payer IDs, so deleting a user alone does not clean up a financial fixture.

## Domains and mail after access ends

Sending, API requests, domain setup changes, and new keys require active billing. Domains and existing keys remain registered, and they work again after billing recovers. Authorized users can still view and remove them. Removing a domain can require removing or migrating its managed inboxes first.

Existing mail is retained and incoming delivery continues for configured inboxes. There is no automated domain deletion, inbound shutdown, or retention deadline. This protects accepted messages from being silently discarded, but receiving and storage can still incur costs. A future inbound suspension policy must address sender rejection and already accepted messages before removing receipt rules or filtering ingestion.

## Resolve deferred customer liability

Inspect one exact ledger event through the protected account operation before considering recovery. Supply `action=inspect`, `user_id`, and `event_id`. The result reports financial and reporting state without returning the event's private metadata.

A merchant-authorized `action=write-off-deferred` requires the exact frozen payer `user_id`, exact `event_id`, and a restricted incident `reason`. The workflow records the triggering administrator and run URL. This action accepts the deferred customer liability as merchant expense. It preserves measured provider cost and the original event, payer, destination, period, source, and charge amounts in the audit record. It removes only the original billable amount from chargeable usage, which can restore allowance headroom. It never records a provider acknowledgment.

Only positive deferred liability that has never been attempted at the provider is eligible. The payer and event are locked, and reporting atomically marks its first attempt before sending. If reporting wins that race, write-off refuses. If write-off wins, reporting sends nothing. Repeating a completed write-off returns the existing terminal resolution. Events without a frozen payer, missing original chargeable amounts, and historical events with ambiguous reporting history are refused. The migration conservatively marks every existing positive unreported event as attempted because earlier writers did not persist attempt evidence. The write-off workflow requires a successful full production deployment of current protected main and refuses if a successful web recovery followed that deployment. If deployment evidence is missing or ambiguous, run a full production redeploy before retrying. Inspection, grants, and bootstrap do not use this gate.

An attempted event may already have been accepted even if local acknowledgment failed. A closed or unconfirmed period cannot safely be retried into a different billing period. Such events require restricted incident evidence and manual provider reconciliation; this command does not resolve them or assert that they were never billed. Do not edit reporting timestamps to bypass that refusal. Credit-backed mail uses the canonical credit ledger for financial completion; legacy mail rows without a matching `mail:` dedupe event retain their own reporting requirement.

```bash
gh workflow run billing-operations.yml --ref main -f action=inspect -f user_id=synthetic-user -f event_id=synthetic-event
gh workflow run billing-operations.yml --ref main -f action=write-off-deferred -f user_id=synthetic-user -f event_id=synthetic-event -f reason=incident:authorized-customer-liability
```
