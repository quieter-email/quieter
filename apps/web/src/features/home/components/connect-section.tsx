"use client";

import { MailboxSwitcherPreview } from "./product-previews";
import { Reveal, RevealChild } from "./reveal";

export const ConnectSection = () => (
  <section
    aria-labelledby="home-connect-title"
    className="home-feature home-connect"
    id="features"
  >
    <Reveal className="home-feature-heading" stagger={0.18}>
      <RevealChild as="h2" className="home-heading" id="home-connect-title">
        All your email, <wbr />
        in one place.
      </RevealChild>
      <RevealChild as="p" className="home-description">
        Connect Gmail, use your own domain,{" "}
        <br className="home-desktop-break" />
        or bring email into your app with API and MCP.
      </RevealChild>
    </Reveal>
    <Reveal delay={0.3}>
      <MailboxSwitcherPreview />
    </Reveal>
  </section>
);
