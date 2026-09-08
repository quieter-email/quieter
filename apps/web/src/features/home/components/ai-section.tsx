"use client";

import {
  AssistantPreview,
  ComposePreview,
  MailboxPreview,
} from "./product-previews";
import { Reveal } from "./reveal";

export const AiSection = () => (
  <>
    <section
      aria-labelledby="home-labels-title"
      className="w-full max-w-6xl px-6"
    >
      <Reveal>
        <h2
          className="text-center text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl"
          id="home-labels-title"
        >
          An inbox that sorts itself.
        </h2>
        <div aria-hidden className="home-product-stage mt-10">
          <MailboxPreview
            accounts={["Projects", "Receipts", "Personal"]}
            labels
          />
        </div>
        <p className="mx-auto mt-8 max-w-xl text-center text-base leading-relaxed text-balance text-muted-fg">
          Let AI label your mail around your preferences. Everything in its
          place.
        </p>
      </Reveal>
    </section>
    <section
      aria-labelledby="home-drafts-title"
      className="w-full max-w-6xl px-6"
    >
      <Reveal>
        <h2
          className="text-center text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl"
          id="home-drafts-title"
        >
          Still your voice. Just less typing.
        </h2>
        <div aria-hidden className="home-product-stage mt-10">
          <ComposePreview />
        </div>
        <p className="mx-auto mt-8 max-w-xl text-center text-base leading-relaxed text-balance text-muted-fg">
          Draft replies with the context already in your inbox. You review and
          send.
        </p>
      </Reveal>
    </section>
    <section
      aria-labelledby="home-chat-title"
      className="w-full max-w-6xl px-6"
    >
      <Reveal>
        <h2
          className="text-center text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl"
          id="home-chat-title"
        >
          Less searching. More knowing.
        </h2>
        <div aria-hidden className="home-product-stage mt-10">
          <AssistantPreview />
        </div>
        <p className="mx-auto mt-8 max-w-xl text-center text-base leading-relaxed text-balance text-muted-fg">
          Start with a daily brief, or ask your mailbox directly. AI is always
          optional.
        </p>
      </Reveal>
    </section>
  </>
);
