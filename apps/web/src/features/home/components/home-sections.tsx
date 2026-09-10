"use client";

import { AI_COST_RECOVERY_BASIS_POINTS } from "@quieter/billing/ai-pricing";
import { BILLING_PRODUCTS, GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import { getManagedUsageRates } from "@quieter/billing/ses-pricing";

import { AiSection } from "./ai-section";
import { ConnectSection } from "./connect-section";
import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { WorkflowPreview } from "./product-previews";
import { Reveal, RevealChild } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

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
    <Reveal className="home-feature-heading" stagger={0.18}>
      <RevealChild as="h2" className="home-heading" id="home-pricing-title">
        Pricing.
      </RevealChild>
      <RevealChild as="p" className="home-description">
        Start with Gmail. <br className="home-desktop-break" />
        Add managed email or AI when you need it.
      </RevealChild>
    </Reveal>
    <div>
      <Reveal className="home-pricing-rows" delay={0.24} stagger={0.18}>
        {tiers.map((tier) => (
          <RevealChild className="home-pricing-row" key={tier.name}>
            <h3>{tier.name}</h3>
            <div className="home-plan-description">
              <p>{tier.summary}</p>
              {tier.credits === null ? null : (
                <p className="home-plan-credits">
                  ${tier.credits} in credits included.
                </p>
              )}
            </div>
            <p className="home-plan-price">
              <span>${tier.price}</span>
              <span className="home-plan-period">/ month</span>
            </p>
          </RevealChild>
        ))}
      </Reveal>
      <Reveal className="home-pricing-notes" stagger={0.14}>
        <RevealChild as="p">
          Managed mail starts at ${rates.messagesPerThousandUsd.toFixed(2)} per
          1k messages.
        </RevealChild>
        <RevealChild as="p">
          Outbound: ${rates.messagesPerThousandUsd.toFixed(2)} per 1k recipient
          deliveries, plus ${rates.attachmentDataPerGbUsd.toFixed(2)} per GB of
          attachments.
          <br />
          Inbound: ${rates.messagesPerThousandUsd.toFixed(2)} per 1k messages,
          plus ${rates.inboundProcessingPerThousandUsd.toFixed(2)} per 1k 256 KB
          units of data, including attachments.
        </RevealChild>
        <RevealChild as="p">
          AI usage is billed at{" "}
          <a href="https://openrouter.ai" rel="noreferrer" target="_blank">
            API cost
          </a>{" "}
          plus {AI_COST_RECOVERY_BASIS_POINTS / 100}%.
        </RevealChild>
        <RevealChild as="p">
          Usage beyond your included credits is billed separately.
        </RevealChild>
      </Reveal>
    </div>
  </section>
);

const Closing = () => (
  <section className="home-closing">
    <HomeAtmosphericBackground
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
