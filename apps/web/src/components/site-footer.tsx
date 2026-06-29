"use client";

import { cn } from "@quieter/ui";
import { Link, useLocation } from "@tanstack/react-router";
import { ConsentPreferencesLink } from "~/components/consent-preferences-link";

const publicFooterRoutes = new Set(["/home", "/privacy", "/cookies", "/terms", "/imprint"]);

const FooterLinks = ({ className }: { className?: string }) => (
  <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
    <Link className="hover:text-foreground" to="/privacy">
      Privacy
    </Link>
    <Link className="hover:text-foreground" to="/cookies">
      Cookies
    </Link>
    <Link className="hover:text-foreground" to="/terms">
      Terms
    </Link>
    <Link className="hover:text-foreground" to="/imprint">
      Imprint
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
);

export const SiteFooter = () => {
  const pathname = useLocation({
    select: (location) => location.pathname,
  });

  if (publicFooterRoutes.has(pathname)) {
    return (
      <footer className="border-t border-border/70 bg-background py-6 text-sm text-muted-foreground">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 md:px-8">
          <p>© 2026 quieter</p>
          <FooterLinks className="max-w-xl md:justify-end" />
        </div>
      </footer>
    );
  }

  return (
    <footer className="pointer-events-none fixed right-0 bottom-0 z-20 max-w-[min(100vw-1rem,42rem)] p-3 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <FooterLinks className="pointer-events-auto justify-end text-[10px] leading-none text-muted-foreground/75" />
    </footer>
  );
};
