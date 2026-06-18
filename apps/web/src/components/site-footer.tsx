"use client";

import { Link } from "@tanstack/react-router";
import { ConsentPreferencesLink } from "~/components/consent-preferences-link";

export const SiteFooter = () => (
  <footer className="pointer-events-none fixed right-0 bottom-0 z-20 max-w-[min(100vw-1rem,42rem)] p-3 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
    <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[10px] leading-none text-muted-foreground/75">
      <Link className="hover:text-foreground" to="/privacy">
        Privacy
      </Link>
      <Link className="hover:text-foreground" to="/cookies">
        Cookies
      </Link>
      <Link className="hover:text-foreground" to="/terms">
        Terms
      </Link>
      <ConsentPreferencesLink className="hover:text-foreground">Preferences</ConsentPreferencesLink>
      <a
        className="hover:text-foreground"
        href="https://logo.dev"
        rel="noreferrer"
        target="_blank"
        title="Logos provided by logo.dev"
      >
        Logos by logo.dev
      </a>
    </div>
  </footer>
);
