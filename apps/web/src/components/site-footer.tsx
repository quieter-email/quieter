"use client";

import { Link } from "@tanstack/react-router";
import { ConsentPreferencesLink } from "~/components/consent-preferences-link";

export const SiteFooter = () => (
  <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-[10px] text-muted-foreground">
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-1">
      <Link className="hover:text-foreground" to="/privacy">
        Privacy
      </Link>
      <Link className="hover:text-foreground" to="/cookies">
        Cookies
      </Link>
      <Link className="hover:text-foreground" to="/terms">
        Terms
      </Link>
      <ConsentPreferencesLink className="hover:text-foreground" />
    </div>

    <a
      className="pointer-events-auto hover:text-foreground"
      href="https://logo.dev"
      rel="noreferrer"
      target="_blank"
      title="Logos provided by logo.dev"
    >
      Logos provided by logo.dev
    </a>
  </footer>
);
