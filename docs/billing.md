# Billing operations

## Production webhook setup

Production configuration, secrets, migrations, and deployments require explicit authorization. Use the protected production workflow, and never copy production credentials into `.env.local`.

Production SST state and secrets are in AWS `eu-central-1`. The production provider is pinned to that region in `sst.config.ts`; local development can still use a different region. A successful secret read from another region does not verify production configuration. For older worktrees on this workstation, use `quieter-sst -Stage production` from the shared PowerShell tooling to select the correct region.

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

## Domains and mail after access ends

Sending, API requests, domain setup changes, and new keys require active billing. Domains and existing keys remain registered, and they work again after billing recovers. Authorized users can still view and remove them. Removing a domain can require removing or migrating its managed inboxes first.

Existing mail is retained and incoming delivery continues for configured inboxes. There is no automated domain deletion, inbound shutdown, or retention deadline. This protects accepted messages from being silently discarded, but receiving and storage can still incur costs. A future inbound suspension policy must address sender rejection and already accepted messages before removing receipt rules or filtering ingestion.
