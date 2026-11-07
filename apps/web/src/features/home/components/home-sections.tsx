"use client";

import { getConnectorIcon } from "@quieter/app/lib/connector-icons";
import { BILLING_PRODUCTS, GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import { getManagedUsageRates } from "@quieter/billing/ses-pricing";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@quieter/ui/accordion";
import { cn } from "@quieter/ui/cn";

import { HomeAtmosphericBackground } from "./lazy-webgl-backgrounds";
import { ProductScreenshotStage } from "./product-screenshots";
import { Reveal, RevealChild } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

type HomeFact = {
  title: string;
  description: string;
};

const mailFacts = [
  { description: "Filters, attachments, and conversations.", title: "Search" },
  {
    description: "Bulk actions, labels, and unsubscribe.",
    title: "Mail controls",
  },
  {
    description: "Desktop app, themes, and keyboard shortcuts.",
    title: "Your workspace",
  },
] satisfies HomeFact[];

const aiFacts = [
  { description: "Answers with source emails.", title: "Mailbox chat" },
  {
    description: "Your rules, applied as mail arrives.",
    title: "Automatic labels",
  },
  { description: "A separate view for what matters.", title: "Important mail" },
  { description: "Preferences and context, carried forward.", title: "Memory" },
  {
    description: "Routine tasks from incoming mail.",
    title: "Mailbox actions",
  },
] satisfies HomeFact[];

const platformFacts = [
  { description: "Your accounts, in one place.", title: "Gmail" },
  { description: "Send and receive on your domain.", title: "Managed mail" },
  { description: "REST API, TypeScript SDK, MCP sending.", title: "API & MCP" },
  {
    description: "Mailboxes, members, roles, and divisions.",
    title: "Team access",
  },
  {
    description: "Status, image-load activity, and blocked recipients.",
    title: "Delivery",
  },
  {
    description: "Credits, usage, and spending limits.",
    title: "Usage and limits",
  },
] satisfies HomeFact[];

const connectedApps = [
  { name: "Linear", provider: "linear" },
  { name: "Notion", provider: "notion" },
  { name: "Todoist", provider: "todoist" },
  { name: "ClickUp", provider: "clickup" },
  { name: "Outlook Calendar", provider: "microsoft_calendar" },
  { name: "OneDrive", provider: "microsoft_onedrive" },
] satisfies {
  name: string;
  provider: Parameters<typeof getConnectorIcon>[0];
}[];

const rates = getManagedUsageRates();
const tiers = [
  {
    credits: null,
    features: [
      `Up to ${GMAIL_MAILBOX_LIMITS.free} Gmail accounts`,
      "Live inbox updates",
    ],
    name: "Free",
    price: 0,
  },
  {
    credits: BILLING_PRODUCTS.managed.creditAmountCents / 100,
    features: [
      `Up to ${GMAIL_MAILBOX_LIMITS.managed} Gmail accounts`,
      "Managed mail and custom domains",
    ],
    name: BILLING_PRODUCTS.managed.name,
    price: BILLING_PRODUCTS.managed.monthlyPriceCents / 100,
  },
  {
    credits: BILLING_PRODUCTS.pro.creditAmountCents / 100,
    features: [
      `Up to ${GMAIL_MAILBOX_LIMITS.pro} Gmail accounts`,
      "Everything in Managed",
      "All AI features",
    ],
    name: BILLING_PRODUCTS.pro.name,
    price: BILLING_PRODUCTS.pro.monthlyPriceCents / 100,
  },
] as const;

const Pricing = () => (
  <section
    aria-labelledby="home-pricing-title"
    className="home-feature home-pricing"
    id="pricing"
  >
    <Reveal>
      <h2 className="home-heading" id="home-pricing-title">
        Pricing.
      </h2>
    </Reveal>
    <Reveal className="home-pricing-plans" stagger={0.06}>
      {tiers.map((tier) => (
        <RevealChild className="home-plan" key={tier.name}>
          <h3>{tier.name}</h3>
          <p className="home-plan-price">
            <span>${tier.price}</span>
            <span className="home-plan-period">/ month</span>
          </p>
          <div className="home-plan-description">
            {tier.features.map((feature) => (
              <p key={feature}>{feature}</p>
            ))}
            {tier.credits === null ? null : (
              <p>${tier.credits} in credits included.</p>
            )}
          </div>
        </RevealChild>
      ))}
    </Reveal>
    <Reveal className="home-pricing-notes">
      <p>Gmail limits are per team. Additional usage billed separately.</p>
      <p>
        Managed mail from ${rates.messagesPerThousandUsd.toFixed(2)} per 1,000
        messages.
      </p>
      <div className="home-usage-rates">
        <Accordion>
          <AccordionItem value="usage-rates">
            <AccordionHeader>
              <AccordionTrigger>Usage rates</AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel>
              <div className="flex flex-col gap-3">
                <p>
                  Outbound: ${rates.messagesPerThousandUsd.toFixed(2)} per 1,000
                  recipient deliveries, plus $
                  {rates.attachmentDataPerGbUsd.toFixed(2)} per GB of
                  attachments.
                </p>
                <p>
                  Inbound: ${rates.messagesPerThousandUsd.toFixed(2)} per 1,000
                  messages, plus $
                  {rates.inboundProcessingPerThousandUsd.toFixed(2)} per 1,000
                  256 KB units of data, including attachments.
                </p>
                <p>Usage beyond your included credits is billed separately.</p>
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>
    </Reveal>
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
      <Reveal as="h2" className="home-closing-heading" stagger={0.06}>
        <RevealChild as="span">Email can do more without</RevealChild>{" "}
        <RevealChild as="span">asking more from you.</RevealChild>
      </Reveal>
      <Reveal className="home-waitlist-wrap" delay={0.12}>
        <WaitlistForm className="home-waitlist" id="closing" />
      </Reveal>
    </div>
  </section>
);

export const HomeSections = () => (
  <>
    <div className="home-features">
      <section
        aria-labelledby="home-inbox-title"
        className="home-feature home-inbox"
        id="features"
      >
        <Reveal className="home-feature-heading">
          <h2 className="home-heading" id="home-inbox-title">
            All your email, together.
          </h2>
          <p className="home-description">
            Gmail, custom domains, and API &amp; MCP.
          </p>
        </Reveal>
        <Reveal>
          <ProductScreenshotStage screenshot="inbox" />
        </Reveal>
        <Reveal className="home-mail-facts" stagger={0.06}>
          {mailFacts.map((fact) => (
            <RevealChild className="home-fact" key={fact.title}>
              <h3>{fact.title}</h3>
              <p>{fact.description}</p>
            </RevealChild>
          ))}
        </Reveal>
      </section>
      <section aria-labelledby="home-ai-title" className="home-feature home-ai">
        <Reveal>
          <h2 className="home-heading" id="home-ai-title">
            AI for Gmail.
          </h2>
        </Reveal>
        <div className="home-ai-layout">
          <Reveal className="home-ai-screenshot">
            <ProductScreenshotStage screenshot="assistant" />
          </Reveal>
          <Reveal className="home-ai-facts" stagger={0.06}>
            {aiFacts.map((fact) => (
              <RevealChild className="home-fact" key={fact.title}>
                <h3>{fact.title}</h3>
                <p>{fact.description}</p>
              </RevealChild>
            ))}
          </Reveal>
        </div>
      </section>
      <div className="home-product-gallery">
        <section
          aria-labelledby="home-drafts-title"
          className="home-product-feature"
        >
          <Reveal>
            <ProductScreenshotStage screenshot="compose" />
          </Reveal>
          <Reveal className="home-product-caption">
            <h2 id="home-drafts-title">Drafts and replies.</h2>
            <p className="home-description">
              Snippets, dictation, and attachments.
            </p>
            <p className="home-product-note">
              Replies, forwards, and signatures.
            </p>
          </Reveal>
        </section>
        <section
          aria-labelledby="home-calendar-title"
          className="home-product-feature home-calendar-feature"
        >
          <Reveal>
            <ProductScreenshotStage screenshot="calendar" />
          </Reveal>
          <Reveal className="home-product-caption">
            <h2 id="home-calendar-title">Calendar, right here.</h2>
            <p className="home-description">
              Views, recurring events, and reminders.
            </p>
            <p className="home-product-note">Google and Outlook calendars.</p>
          </Reveal>
        </section>
      </div>
      <section
        aria-labelledby="home-platform-title"
        className="home-feature home-platform"
      >
        <Reveal>
          <h2 className="home-heading" id="home-platform-title">
            Team and transactional mail.
          </h2>
        </Reveal>
        <Reveal className="home-platform-facts" stagger={0.06}>
          {platformFacts.map((fact) => (
            <RevealChild className="home-fact" key={fact.title}>
              <h3>{fact.title}</h3>
              <p>{fact.description}</p>
            </RevealChild>
          ))}
        </Reveal>
      </section>
      <section
        aria-labelledby="home-apps-title"
        className="home-connected-apps"
      >
        <Reveal>
          <h2 id="home-apps-title">Connected apps.</h2>
        </Reveal>
        <Reveal className="home-apps-list" stagger={0.04}>
          {connectedApps.map((app) => {
            const icon = getConnectorIcon(app.provider);
            return (
              <RevealChild className="home-connected-app" key={app.provider}>
                <img
                  alt=""
                  aria-hidden
                  className={cn("home-connector-icon", icon.className)}
                  height={20}
                  loading="lazy"
                  src={icon.src}
                  width={20}
                />
                <span>{app.name}</span>
              </RevealChild>
            );
          })}
        </Reveal>
      </section>
      <Pricing />
    </div>
    <Closing />
  </>
);
