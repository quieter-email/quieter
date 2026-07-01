"use client";

import { useHeadlessConsentUI, useTranslations } from "@c15t/react";
import { Button } from "@quieter/ui/button";
import { Link } from "@tanstack/react-router";

export const ConsentBanner = () => {
  const translations = useTranslations();
  const { banner, openDialog, performBannerAction } = useHeadlessConsentUI();

  if (!banner.isVisible) {
    return null;
  }

  return (
    <section
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background-light/95 shadow-lg backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{translations.cookieBanner.title}</p>
          <p className="text-sm/6 text-muted-foreground">{translations.cookieBanner.description}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Link className="underline hover:text-foreground" to="/privacy">
              Privacy Policy
            </Link>
            <Link className="underline hover:text-foreground" to="/cookies">
              Cookie Policy
            </Link>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              void performBannerAction("reject");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {translations.common.rejectAll}
          </Button>
          <Button onClick={openDialog} size="sm" type="button" variant="outline">
            {translations.common.customize}
          </Button>
          <Button
            onClick={() => {
              void performBannerAction("accept");
            }}
            size="sm"
            type="button"
          >
            {translations.common.acceptAll}
          </Button>
        </div>
      </div>
    </section>
  );
};
