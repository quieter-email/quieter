"use client";

import { ConsentPreferencesLink } from "@quieter/app/components/consent-preferences-link";
import { Brand } from "@quieter/ui/brand";
import { cn } from "@quieter/ui/cn";
import { Link, useLocation } from "@tanstack/react-router";
import { domAnimation, LazyMotion } from "motion/react";

import { Reveal } from "#/features/home/components/reveal";

const publicFooterRoutes = new Set([
  "/home",
  "/privacy",
  "/cookies",
  "/terms",
  "/imprint",
]);

const FooterLinks = ({
  className,
  tabIndex,
}: {
  className?: string;
  tabIndex?: number;
}) => (
  <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
    <Link className="hover:text-fg" tabIndex={tabIndex} to="/privacy">
      Privacy
    </Link>
    <Link className="hover:text-fg" tabIndex={tabIndex} to="/cookies">
      Cookies
    </Link>
    <Link className="hover:text-fg" tabIndex={tabIndex} to="/terms">
      Terms
    </Link>
    <Link className="hover:text-fg" tabIndex={tabIndex} to="/imprint">
      Imprint
    </Link>
    {/* oxlint-disable-next-line shadcn/no-restyle -- The default link variant renders a native text button. */}
    <ConsentPreferencesLink className="hover:text-fg" tabIndex={tabIndex}>
      Preferences
    </ConsentPreferencesLink>
    <a
      className="hover:text-fg"
      href="https://logo.dev"
      rel="noreferrer"
      tabIndex={tabIndex}
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

  if (!publicFooterRoutes.has(pathname)) {
    return null;
  }

  if (pathname === "/home") {
    return (
      <LazyMotion features={domAnimation}>
        <footer className="home-footer dark">
          <div aria-hidden className="home-footer-wordmark">
            <span>quieter</span>
          </div>
          <Reveal className="home-footer-content">
            <div className="home-footer-navigation">
              <Link aria-label="quieter home" to="/home">
                <Brand className="h-7 w-28" variant="combination" />
              </Link>
              <div className="home-footer-columns">
                <nav aria-label="Legal" className="home-footer-column">
                  <h2>Legal</h2>
                  <Link className="hover:text-muted-fg" to="/privacy">
                    Privacy
                  </Link>
                  <Link className="hover:text-muted-fg" to="/cookies">
                    Cookies
                  </Link>
                  <Link className="hover:text-muted-fg" to="/terms">
                    Terms
                  </Link>
                  <Link className="hover:text-muted-fg" to="/imprint">
                    Imprint
                  </Link>
                </nav>
                <div className="home-footer-column">
                  <h2>More</h2>
                  {/* oxlint-disable-next-line shadcn/no-restyle -- The link variant renders a native text button, matching the neighboring footer links. */}
                  <ConsentPreferencesLink className="hover:text-muted-fg">
                    Preferences
                  </ConsentPreferencesLink>
                  <a
                    className="hover:text-muted-fg"
                    href="https://logo.dev"
                    rel="noreferrer"
                    target="_blank"
                    title="Logos provided by logo.dev"
                  >
                    Logos by logo.dev
                  </a>
                </div>
              </div>
            </div>
            <p className="home-footer-copyright">© 2026 quieter</p>
          </Reveal>
        </footer>
      </LazyMotion>
    );
  }

  return (
    <footer className="border-t border-border bg-bg-raised py-6 text-body text-muted-fg">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 md:px-8">
        <p>© 2026 quieter</p>
        <FooterLinks className="max-w-xl md:justify-end" />
      </div>
    </footer>
  );
};
