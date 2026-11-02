"use client";

import { Surface } from "@quieter/ui/surface";
import type { ReactNode } from "react";

import { ComposePreview } from "./compose-preview";
import {
  AssistantPreview,
  ImportantPreview,
  LabelsPreview,
} from "./product-previews";
import { Reveal } from "./reveal";
import { BillingPreview, CalendarPreview } from "./workspace-previews";

const Feature = ({
  children,
  description,
  id,
  title,
}: {
  children: ReactNode;
  description: ReactNode;
  id: string;
  title: string;
}) => (
  <section aria-labelledby={id}>
    <Reveal className="h-full">
      <Surface className="h-full" padding="comfortable" variant="panel">
        <div className="flex h-full flex-col gap-6">
          <div className="home-card-heading">
            <h2 id={id}>{title}</h2>
            <p>{description}</p>
          </div>
          {children}
        </div>
      </Surface>
    </Reveal>
  </section>
);

export const FeatureCards = () => (
  <>
    <div className="home-paired-features">
      <Feature
        id="home-labels-title"
        title="Automatic labels."
        description={
          <>
            Let AI label your mail around your preferences.
            <br />
            Everything in its place, as it arrives.
          </>
        }
      >
        <LabelsPreview />
      </Feature>
      <Feature
        id="home-important-title"
        title="What matters, together."
        description={
          <>
            Important mail, picked out as it arrives.
            <br />
            You decide what deserves your attention.
          </>
        }
      >
        <ImportantPreview />
      </Feature>
    </div>
    <div className="home-paired-features">
      <Feature
        id="home-drafts-title"
        title="Draft replies faster."
        description={
          <>
            Thoughtful drafts with context from your inbox.
            <br />
            You review, make it yours, and send.
          </>
        }
      >
        <ComposePreview />
      </Feature>
      <Feature
        id="home-chat-title"
        title="Ask your mailbox."
        description={
          <>
            Get an answer with the emails to back it up.
            <br />
            AI is optional, always.
          </>
        }
      >
        <AssistantPreview />
      </Feature>
    </div>
    <div className="home-paired-features">
      <Feature
        id="home-calendar-title"
        title="Calendar view."
        description={
          <>
            Make room for what matters.
            <br />
            Your schedule, right beside your inbox.
          </>
        }
      >
        <CalendarPreview />
      </Feature>
      <Feature
        id="home-billing-title"
        title="Transparent billing."
        description={
          <>
            See where every credit goes.
            <br />
            Clear usage, included balances, and rates.
          </>
        }
      >
        <BillingPreview />
      </Feature>
    </div>
  </>
);
