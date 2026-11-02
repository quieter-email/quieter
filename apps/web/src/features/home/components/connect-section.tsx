"use client";

import { Surface } from "@quieter/ui/surface";

import { MailboxSwitcherPreview } from "./product-previews";
import { Reveal } from "./reveal";

export const ConnectSection = () => (
  <section
    aria-labelledby="home-connect-title"
    className="home-feature home-connect"
    id="features"
  >
    <Reveal>
      <Surface padding="comfortable" variant="panel">
        <div className="flex flex-col gap-6">
          <div className="home-feature-heading">
            <h2 className="home-heading" id="home-connect-title">
              All your email, <wbr />
              in one place.
            </h2>
            <p className="home-description">
              Connect Gmail, send transactional mail on your domain,
              <br className="home-desktop-break" />
              or bring email into your app with API and MCP.
            </p>
          </div>
          <MailboxSwitcherPreview />
        </div>
      </Surface>
    </Reveal>
  </section>
);
