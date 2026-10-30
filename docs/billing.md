# Billing operations

## Gmail connections and live updates

All plans receive Gmail live updates. Free teams can connect 5 Gmail accounts, Managed teams 25, and Pro teams 100. The allowance is shared across team members; each Gmail mailbox remains private to its owner. Managed mailboxes do not consume Gmail slots. Limits are defined in `packages/billing/src/plans.ts` and enforced at OAuth start, transactionally at OAuth completion, and when moving a mailbox into a team.

Concurrent connections lock the destination team before counting and writing. Reconnecting an existing mailbox remains allowed after a downgrade; additions and incoming moves stop at the new limit without deleting existing mail. Paid Gmail AI assistance retains its separate entitlement. Watch renewal and notification ingestion do not require that entitlement.

Active, renewing subscriptions retain access when Polar has not advanced the billing period end. Expired trials and scheduled cancellations still stop at that date, and failed provider reconciliation denies access. Usage continues against the existing period start and allowance until Polar renews the period; it does not receive a fresh allowance just because the old end has passed. Persisted send billing snapshots retain the subscription identity. Once a later billing period exists, old snapshots retain their original end because overwritten subscription records cannot establish historical renewal boundaries; they never count later cycles against the previous allowance. Unreported usage from ended cycles is not replayed into the current cycle.

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

Deploy through `.github/workflows/sst-deploy.yml`, which applies migrations before publishing the application. Verify a signed delivery receives HTTP 200 and updates the correct team's billing state. Unsigned, tampered, and stale signatures must be rejected. A missing signing secret returns 404. Synchronization failures return 500 so Polar retries; monitor failed deliveries and Sentry, and re-enable an endpoint if Polar has disabled it after repeated failures.

The receiver verifies both Standard Webhooks signatures and Polar's older scheme. [Polar switches new and reset secrets on September 8, 2026](https://polar.sh/docs/integrate/webhooks/delivery). Older secrets use the UTF-8 bytes of the entire secret as the signing key. New secrets use the decoded Standard Webhooks key. Keep both verification paths while either kind can be configured, and always verify before parsing or applying subscription data.

The private site-password gate already exempts this exact endpoint. It must remain reachable without a browser session; webhook signatures provide authentication.

## Active subscription with an overdue renewal

Check the provider's subscription detail page, attached discount, order history, and merchant review status before creating another checkout. A 100% discount can be valid forever while the subscription's billing cycle remains stalled.

Polar's [organization capabilities](https://github.com/polarsource/polar/blob/main/server/polar/models/organization.py) disable subscription renewals in the initial `CREATED` state. Its [order service](https://github.com/polarsource/polar/blob/main/server/polar/order/service.py) checks that capability for renewal payments. An unfinished merchant review can leave monthly billing blocked while a subscription still appears active, including the zero-total subscriptions observed here. Confirm the account's actual capability through the organization API before attributing other stalled renewals to this restriction.

Complete the merchant setup or ask Polar support to enable the appropriate account capabilities. For private beta access independent of billing, use explicitly authorized, time-limited entitlement grants through a protected database workflow. Do not disable production billing enforcement, manufacture renewal dates, or repeatedly create subscriptions. Existing entitlement overrides belong to a billing owner and can affect more than one team owned by that user; review that scope before granting one.

For temporary recovery of an existing 100%-discount test subscription, Polar's **Update Subscription > Billing Period** control can grant free time by extending the period end. Confirm the discount before applying this change. This does not fix automatic renewal capability, advance the period start, or reset usage credits.

After Polar corrects the period, the webhook or the next billing reconciliation restores access automatically. An active subscription whose period is still overdue is shown as an unconfirmed renewal, and checkout cannot create a duplicate. Failed reconciliation remains distinguishable from an ended subscription. Scheduled cancellation keeps access until the period ends; immediate revocation and exhausted payment retries remove access.

## Usage accounting and recovery

Usage is summed from the local credit ledger for the team's provider period, including the start and excluding the end. A real renewal advances the start and excludes earlier usage. Extending only the end retains that usage. Settings show the actual date range rather than promising a reset on the extended end date.

PostgreSQL returns `sum(bigint)` as a numeric string. Aggregate expressions must use a runtime number decoder before arithmetic. A TypeScript `sql<number>` annotation alone does not convert the value. Without decoding, adding a new charge concatenates the previous sum and the charge, creating invalid overage amounts and potentially rejecting mail below the included balance.

The September 5, 2026 production investigation confirmed:

- Polar's organization is `created`, with `subscription_renewals: false`. Its four orders are all zero-total subscription creations; there are no renewal orders. The two current Pro subscriptions end at October 4, 00:00 Europe/Berlin, while their starts remain unchanged.
- The endpoint secret differs from the actual Frankfurt SST secret. A signed invalid payload using the Frankfurt secret passes the deployed signature check and reaches payload validation. The same probe using the endpoint secret fails signature verification. An unrelated `us-east-1` SST secret namespace matches the endpoint and caused the earlier false-positive comparison. The endpoint remains disabled.
- The local ledger contains events with stored overage exceeding their entire actual cost. Some were marked reported to Polar, but the metered `credits` property uses actual cost; the inflated value is separate metadata. No paid renewal order was found. Customer-specific counts and amounts are recorded in the private verification handoff.
- There is an unreported usage backlog. The actual production token can read subscriptions and accepts an empty event ingestion batch. That scope check does not explain the historical backlog; do not assume all outstanding events have reached Polar.

The code fix prevents new invalid amounts after release; it does not rewrite existing ledger records. Before repairing production, use the protected workflow to preserve a snapshot of affected rows and recompute overage from actual costs and the applicable subscription periods and allowances. Do not subtract the displayed inflated total from a customer's balance or change actual cost, event identity, or event timestamps. Recheck rows after stopping the faulty writer, since counts can continue increasing before release.

The `Repair billing credit overage` workflow runs only from protected main after that exact revision has deployed successfully. It locks the ledger while saving the affected amounts to an encrypted object in the production SST state bucket, then clears invalid overage only for affected organizations whose entire lifetime usage is below the smallest paid allowance. It refuses larger balances and rolls back if the snapshot fails. This is a bounded repair for the observed corruption, not a general historical invoice recalculation. Its database integration tests cover rollback, valid overage preservation, idempotence, and the allowance guard.

After that repair, reconcile the local ledger against Polar events by external ID. Polar events are immutable, and duplicate external IDs do not overwrite incorrect metadata. The retry path preserves original event timestamps, removes duplicate subscription joins, and excludes ended subscription periods. Polar bills late events in the cycle when they are received, regardless of the supplied timestamp. Do not automatically replay usage from closed cycles. See [event ingestion](https://polar.sh/docs/features/usage-based-billing/event-ingestion).

For webhook rotation, keep the endpoint disabled while resetting its secret. Transfer the new value to the production GitHub environment secret `POLAR_WEBHOOK_SECRET`. The protected SST deployment copies it into the linked `PolarWebhookSecret` resource. Verify the deployed signature check before enabling delivery, then verify a real subscription event. Never print the secret or reuse an exposed value.

## AI admission and interrupted requests

Every paid provider call creates an `aiCreditReservation` before sending the request. The operation stores the authorizing account, organization, billing period, usage kind, and admission timestamp. Mailbox moves, deletion, membership changes, and later subscription changes do not change that charge. SDK retries and tool-loop turns each reserve separately, and a completed turn settles before the next turn or nested tool work starts.

The provider endpoints do not all support a monetary request cap. AI reserves all currently available included credit under the same organization lock used by outbound mail. Concurrent AI calls wait for the active call to settle by rejecting admission, and outbound team-mail admission also rejects while an AI hold exists. Existing outbound-mail holds reduce the funds available to AI. This prevents concurrent reuse of the balance. One admitted call can still cost more than the remaining balance because the provider supplies its actual cost afterward. This change does not promise a provider spending cap.

Known provider rejection releases its hold. Known zero-cost completion also restores admission. A timeout, cancellation without final usage, missing cost, or process crash retains its hold. Do not release those holds based on elapsed time. Confirm the provider outcome before using the single-reservation recovery procedure below. Production resolution requires the protected operational workflow and explicit authorization. Provider callbacks keep using the existing settlement and release functions.

Actual cost is persisted before ledger reconciliation. `vp run billing:sync-credit-usage-polar` first calls `reconcileAiCreditReservations` for completed holds, then retries the existing usage-event reporting. Reconciliation and repeated settlements use the same ledger dedupe key. Unknown-outcome holds remain reserved for inspection. Inspect `aiCreditReservation` rows with `status = 'reserved'`; a null `actualCostMicroCents` distinguishes an unconfirmed outcome from a known cost awaiting reconciliation.

Apply the additive reservation-table migration before deploying the application. Drain pre-release provider calls and pending usage-reporting jobs during a coordinated rollout. The legacy reporting path remains for historical operations without reservation groups; new groups are already accounted at the provider boundary. Retire that compatibility path only after historical reporting has drained.

## Recover one interrupted AI reservation

Use `Recover AI credit reservation` in `.github/workflows/ai-credit-recovery.yml` after this revision has merged into protected `main` and that exact revision has deployed successfully. Run it with `--ref main`. Only a repository administrator can run inspection or recovery. The workflow checks the initiating and triggering actors' current repository permissions through GitHub before obtaining AWS credentials. A maintainer or writer is refused. The existing `production` environment restricts execution to protected branches; the job and deployed-revision checks further require `main`. Ref checks inside editable workflow YAML do not establish trust on their own. Administrator dispatch, incident evidence and exact reservation confirmation authorize one resolution. Independently reviewing the evidence before dispatch is recommended but is not an enforced environment approval gate. This procedure does not change environment or IAM settings.

The workflow checks administrator permission, current main and the latest successful production deployment before obtaining AWS credentials. It uses the existing production concurrency group and [SST shell resource links](https://sst.dev/docs/reference/cli/#shell). `DatabaseUrl` reaches `@quieter/env` through `configureServerEnv`. No database credential is placed in workflow inputs or ordinary environment configuration. The script makes no provider lookup, billing-provider call, or migration.

1. Obtain the reservation UUID and original organization ID from the restricted incident record. Inspect exactly that reservation. Replace the synthetic IDs below. The JSON is passed as one quoted argument.

   ```bash
   gh workflow run ai-credit-recovery.yml --ref main -f request='{"mode":"inspect","reservationId":"11111111-1111-4111-8111-111111111111","organizationId":"synthetic-team"}'
   ```

   Read the completed run log. It returns the admission time, original period, held and known actual cost in microcents, status, whether provider identity exists, and a SHA-256 `snapshot`. It omits account/customer identities, group identifiers, prompts, addresses and credentials. Inspection does not release funds. An unknown outcome remains held.

2. Stop or drain the originating request and establish its final provider outcome using restricted provider records. Cancellation, missing logs and elapsed time are insufficient evidence of non-execution. Use actual billed USD before the existing recovery fee for `actual-cost`, including zero for a confirmed zero-cost completion. Use `non-execution` only when authoritative records prove that no provider execution occurred. If no reliable evidence exists, keep the hold. Non-execution refuses a persisted provider identity or actual cost. Automatic reconciliation remains the preferred path when final cost is already known.

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

   Pass this JSON through the same `gh workflow run ... -f request='...'` command. A successful dry-run reports the final cost and status without changing admission or ledger state. For confirmed non-execution, replace `resolution` with `{"kind":"non-execution"}` and use the corresponding evidence and reason.

4. Obtain explicit authorization for this reservation and evidence. Submit the same request with `mode` set to `resolve` and `confirmation` set to `resolve:RESERVATION_UUID:SNAPSHOT`. The workflow and command require an unchanged reservation, including its stored account, organization, period, provider metadata and cost. Any concurrent change fails closed. Inspect again and re-evaluate the evidence before resubmitting a changed request.

Resolution takes the organization lock before the reservation lock. It commits audit metadata, the original-period ledger entry and the terminal hold transition together. Confirmed non-execution writes a zero-cost audit entry and releases the hold. Confirmed actual cost uses the existing price conversion and settles the hold. Recovery audit references stay in the local ledger and are excluded from external billing metadata. Existing synchronization reports positive usage after commit, subject to the closed-period reporting rules above. Successful resolution restores AI and outbound mail admission when the account otherwise has available credit and access.

Identical command retries with the same snapshot, evidence, reason and operator return `already-resolved` without charging twice. The production operator tag includes the run ID, so a new workflow run must inspect again and will refuse to resolve an already terminal reservation. A workflow rerun by the same administrator preserves its run ID and supports an exact retry. A conflicting cost, opposite outcome, changed audit reference or changed persisted state fails. Do not edit the ledger, account snapshot or reservation to bypass a refusal.

For local debugging, use only a disposable loopback database or an existing approved local database. Build `@quieter/env`, provide the ignored local configuration and run `vp run env:doctor` after configuration changes. Run `vp exec node --env-file=.env.local scripts/ai-credit-recovery.ts 'JSON_COMMAND' --local`. Local dry-run and resolution requests must include an incident-safe `operator` reference. Local execution requires `QUIETER_DEPLOYMENT_ENV=local` and a loopback database; the command never silently selects production. The focused PostgreSQL suite uses only `quieter_migration_test` on loopback and synthetic data.

## Domains and mail after access ends

Sending, API requests, domain setup changes, and new keys require active billing. Domains and existing keys remain registered, and they work again after billing recovers. Authorized users can still view and remove them. Removing a domain can require removing or migrating its managed inboxes first.

Existing mail is retained and incoming delivery continues for configured inboxes. There is no automated domain deletion, inbound shutdown, or retention deadline. This protects accepted messages from being silently discarded, but receiving and storage can still incur costs. A future inbound suspension policy must address sender rejection and already accepted messages before removing receipt rules or filtering ingestion.
