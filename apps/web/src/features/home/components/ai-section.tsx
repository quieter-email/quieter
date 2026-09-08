"use client";

import {
  AssistantPreview,
  BriefPreview,
  ComposePreview,
  LabelsPreview,
} from "./product-previews";
import { Reveal, RevealChild } from "./reveal";

export const AiSection = () => (
  <>
    <section aria-labelledby="home-labels-title" className="home-feature">
      <Reveal className="home-feature-heading" stagger={0.18}>
        <RevealChild as="h2" className="home-heading" id="home-labels-title">
          Automatic labels.
        </RevealChild>
        <RevealChild as="p" className="home-description">
          Let AI label your mail around your preferences.{" "}
          <br className="home-desktop-break" />
          Everything in its place, as it arrives.
        </RevealChild>
      </Reveal>
      <Reveal delay={0.3}>
        <LabelsPreview />
      </Reveal>
    </section>
    <div className="home-feature home-paired-features">
      <section aria-labelledby="home-brief-title">
        <Reveal className="home-paired-feature" stagger={0.18}>
          <RevealChild as="h2" className="home-heading" id="home-brief-title">
            Your daily brief.
          </RevealChild>
          <RevealChild as="p" className="home-description">
            A daily brief of what needs your attention.
            <br />
            Catch up without opening every email.
          </RevealChild>
          <RevealChild>
            <BriefPreview />
          </RevealChild>
        </Reveal>
      </section>
      <section aria-labelledby="home-drafts-title">
        <Reveal className="home-paired-feature" delay={0.12} stagger={0.18}>
          <RevealChild as="h2" className="home-heading" id="home-drafts-title">
            Draft replies faster.
          </RevealChild>
          <RevealChild as="p" className="home-description">
            Thoughtful drafts with context from your inbox.
            <br />
            You review, make it yours, and send.
          </RevealChild>
          <RevealChild>
            <ComposePreview />
          </RevealChild>
        </Reveal>
      </section>
    </div>
    <section aria-labelledby="home-chat-title" className="home-feature">
      <Reveal className="home-feature-heading" stagger={0.18}>
        <RevealChild as="h2" className="home-heading" id="home-chat-title">
          Ask your mailbox.
        </RevealChild>
        <RevealChild as="p" className="home-description">
          Get an answer with the emails to back it up.{" "}
          <br className="home-desktop-break" />
          AI is optional, always.
        </RevealChild>
      </Reveal>
      <Reveal delay={0.3}>
        <AssistantPreview />
      </Reveal>
    </section>
  </>
);
