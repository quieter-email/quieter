"use client";

import { Reveal } from "./landing-shared";

const paths = [
  {
    body: "Bring the mailbox you already use. Labels, drafts, read state, and sends stay mirrored in both directions.",
    index: "01",
    title: "Connect Gmail",
  },
  {
    body: "Create support@ or billing@ on a domain you own. Mail arrives directly, with no forwarding chains or alias workarounds.",
    index: "02",
    title: "Run your domain",
  },
  {
    body: "Deliver product email from verified domains with a simple API. Sent mail stays beside the replies it creates.",
    index: "03",
    title: "Send from your product",
  },
] as const;

export const LandingStatementSection = () => (
  <section className="scroll-mt-14 px-5 py-28 md:px-8 md:py-40" id="product">
    <div className="mx-auto w-full max-w-6xl">
      <Reveal>
        <p className="max-w-3xl text-2xl/snug font-normal tracking-tight text-balance md:text-[2rem]">
          <span className="text-foreground">One place for every kind of email. </span>
          <span className="text-muted-foreground/70">
            Quieter connects the mailbox you have, the domain you own, and the mail your product
            sends, without asking you to change how you work.
          </span>
        </p>
      </Reveal>

      <div className="mt-20 grid gap-12 md:mt-28 md:grid-cols-3 md:gap-10">
        {paths.map((path, index) => (
          <Reveal delay={index * 0.08} key={path.index}>
            <div className="h-px w-full bg-white/10" />
            <p className="mt-6 font-mono text-xs text-muted-foreground/50">{path.index}</p>
            <h3 className="mt-4 text-base font-normal tracking-tight text-foreground">
              {path.title}
            </h3>
            <p className="mt-2.5 max-w-xs text-sm/6 text-muted-foreground">{path.body}</p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);
