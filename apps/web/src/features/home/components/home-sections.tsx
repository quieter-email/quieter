"use client";

import { BILLING_PRODUCTS, GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import { getManagedUsageRates } from "@quieter/billing/ses-pricing";
import { Surface } from "@quieter/ui/surface";

import { AiSection } from "./ai-section";
import { ConnectSection } from "./connect-section";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { Reveal, RevealChild } from "./reveal";
import { WaitlistForm } from "./waitlist-form";
import { WorkflowPreview } from "./workflow-previews";

const rates = getManagedUsageRates();
const tiers = [
  {
    credits: null,
    name: "Free",
    price: 0,
    summary: `Up to ${GMAIL_MAILBOX_LIMITS.free} Gmail accounts per team, with live updates.`,
  },
  {
    credits: BILLING_PRODUCTS.managed.creditAmountCents / 100,
    name: BILLING_PRODUCTS.managed.name,
    price: BILLING_PRODUCTS.managed.monthlyPriceCents / 100,
    summary: `Up to ${GMAIL_MAILBOX_LIMITS.managed} Gmail accounts per team, plus managed mail and custom domains.`,
  },
  {
    credits: BILLING_PRODUCTS.pro.creditAmountCents / 100,
    name: BILLING_PRODUCTS.pro.name,
    price: BILLING_PRODUCTS.pro.monthlyPriceCents / 100,
    summary: `Up to ${GMAIL_MAILBOX_LIMITS.pro} Gmail accounts per team. Everything in Managed, plus all AI features.`,
  },
] as const;

const Pricing = () => (
  <section
    aria-labelledby="home-pricing-title"
    className="home-feature home-pricing"
    id="pricing"
  >
    <Reveal className="home-pricing-heading" stagger={0.18}>
      <RevealChild as="h2" className="home-heading" id="home-pricing-title">
        Pricing.
      </RevealChild>
      <RevealChild as="p" className="home-description">
        Start with Gmail. Add managed email or AI when you need it.
      </RevealChild>
    </Reveal>
    <div>
      <Reveal className="home-pricing-plans" delay={0.24} stagger={0.18}>
        {tiers.map((tier) => (
          <RevealChild className="h-full" key={tier.name}>
            <Surface className="h-full" padding="comfortable">
              <div className="flex h-full flex-col gap-5">
                <h3>{tier.name}</h3>
                <p className="home-plan-price">
                  <span>${tier.price}</span>
                  <span className="home-plan-period">/ month</span>
                </p>
                <div className="home-plan-description">
                  <p>{tier.summary}</p>
                  {tier.credits === null ? null : (
                    <p className="home-plan-credits">
                      ${tier.credits} in credits included.
                    </p>
                  )}
                </div>
              </div>
            </Surface>
          </RevealChild>
        ))}
      </Reveal>
      <Reveal className="home-pricing-notes" stagger={0.14}>
        <Surface padding="comfortable" variant="panel">
          <div className="flex flex-col gap-3">
            <RevealChild as="p">
              Managed mail starts at ${rates.messagesPerThousandUsd.toFixed(2)}{" "}
              per 1k messages.
            </RevealChild>
            <RevealChild as="p">
              Outbound: ${rates.messagesPerThousandUsd.toFixed(2)} per 1k
              recipient deliveries, plus $
              {rates.attachmentDataPerGbUsd.toFixed(2)} per GB of attachments.
              <br />
              Inbound: ${rates.messagesPerThousandUsd.toFixed(2)} per 1k
              messages, plus ${rates.inboundProcessingPerThousandUsd.toFixed(2)}{" "}
              per 1k 256 KB units of data, including attachments.
            </RevealChild>
            <RevealChild as="p">
              Usage beyond your included credits is billed separately.
            </RevealChild>
          </div>
        </Surface>
      </Reveal>
    </div>
  </section>
);

const Closing = () => (
  <section className="home-closing">
    <HomeAtmosphericBackground
      className="home-atmosphere home-atmosphere-closing"
      fadeBottom="black"
      fadeTop="black"
      variant="closing"
    />
    <div className="home-closing-content">
      <Reveal as="h2" className="home-closing-heading" stagger={0.2}>
        <RevealChild as="span">Email can do more without</RevealChild>{" "}
        <RevealChild as="span">asking more from you.</RevealChild>
      </Reveal>
      <Reveal className="home-waitlist-wrap" delay={0.44}>
        <WaitlistForm className="home-waitlist" id="closing" />
      </Reveal>
    </div>
  </section>
);

export const HomeSections = () => (
  <>
    <div className="home-features">
      <ConnectSection />
      <AiSection />
      <section aria-labelledby="home-tools-title" className="home-feature">
        <Reveal>
          <h2 className="home-heading" id="home-tools-title">
            Everyday email tools.
          </h2>
        </Reveal>
        <WorkflowPreview />
      </section>
      <Pricing />
    </div>
    <Closing />
  </>
);
