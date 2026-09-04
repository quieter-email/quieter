# Billing operations

## Production webhook setup

Production configuration, secrets, migrations, and deployments require explicit authorization. Use the protected production workflow, and never copy production credentials into `.env.local`.

In the production Polar organization, add an endpoint for `https://quieter.email/api/auth/polar/webhooks`. Subscribe to:

- `subscription.created`
- `subscription.updated`
- `subscription.active`
- `subscription.canceled`
- `subscription.uncanceled`
- `subscription.past_due`
- `subscription.revoked`
- `subscription.paused` and `subscription.resumed`, when available

Store the endpoint's signing secret in the production SST secret `PolarWebhookSecret`. The runtime reads it as `POLAR_WEBHOOK_SECRET` through `@quieter/env`. `PolarAccessToken` is separately required for checkout, the customer portal, and reconciliation. Receiving signed webhooks does not require an API token.

Deploy through `.github/workflows/sst-deploy.yml`, which applies migrations before publishing the application. Verify a signed delivery receives HTTP 200 and updates the correct team's billing state. Unsigned, tampered, and stale signatures must be rejected. A missing signing secret returns 404. Synchronization failures return 500 so Polar retries; monitor failed deliveries and Sentry, and re-enable an endpoint if Polar has disabled it after repeated failures.

The receiver verifies both Standard Webhooks signatures and Polar's older scheme. [Polar switches new and reset secrets on September 8, 2026](https://polar.sh/docs/integrate/webhooks/delivery). Older secrets use the UTF-8 bytes of the entire secret as the signing key. New secrets use the decoded Standard Webhooks key. Keep both verification paths while either kind can be configured, and always verify before parsing or applying subscription data.

The private site-password gate already exempts this exact endpoint. It must remain reachable without a browser session; webhook signatures provide authentication.

## Active subscription with an overdue renewal

Check the provider's subscription detail page, attached discount, order history, and merchant review status before creating another checkout. A 100% discount can be valid forever while the subscription's billing cycle remains stalled.

Polar's [organization capabilities](https://github.com/polarsource/polar/blob/main/server/polar/models/organization.py) disable subscription renewals in the initial `CREATED` state. Its [subscription cycle](https://github.com/polarsource/polar/blob/main/server/polar/subscription/service.py) then skips the renewal without advancing the period or marking the subscription canceled. An unfinished merchant review can therefore produce an active subscription with a renewal date in the past, even for a zero-total order. Confirm the account's actual status with Polar before attributing other stalled renewals to this restriction.

Complete the merchant setup or ask Polar support to enable the appropriate account capabilities. For private beta access independent of billing, use explicitly authorized, time-limited entitlement grants through a protected database workflow. Do not disable production billing enforcement, manufacture renewal dates, or repeatedly create subscriptions. Existing entitlement overrides belong to a billing owner and can affect more than one team owned by that user; review that scope before granting one.

After Polar corrects the period, the webhook or the next billing reconciliation restores access automatically. An active subscription whose period is still overdue is shown as an unconfirmed renewal, and checkout cannot create a duplicate. Failed reconciliation remains distinguishable from an ended subscription. Scheduled cancellation keeps access until the period ends; immediate revocation and exhausted payment retries remove access.

## Domains and mail after access ends

Sending, API requests, domain setup changes, and new keys require active billing. Domains and existing keys remain registered, and they work again after billing recovers. Authorized users can still view and remove them. Removing a domain can require removing or migrating its managed inboxes first.

Existing mail is retained and incoming delivery continues for configured inboxes. There is no automated domain deletion, inbound shutdown, or retention deadline. This protects accepted messages from being silently discarded, but receiving and storage can still incur costs. A future inbound suspension policy must address sender rejection and already accepted messages before removing receipt rules or filtering ingestion.
