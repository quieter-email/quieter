/// <reference types="vite/client" />

import { brand } from "@quieter/ui/brand-geometry";
import { createRootRoute } from "@tanstack/react-router";

import { RootComponent } from "#/components/root/root-component";
import { RootDocument } from "#/components/root/root-document";
import { RootErrorComponent } from "#/components/root/root-error-component";
import { RootNotFoundComponent } from "#/components/root/root-not-found-component";

import appCss from "../styles.css?url";

const appCssHref: string = typeof appCss === "string" ? appCss : "";

let faviconVariant = "";
if (import.meta.env.DEV) {
  faviconVariant = "-dev";
}

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  address: {
    "@type": "PostalAddress",
    addressCountry: "DE",
    addressLocality: "Berlin",
    streetAddress: "Cosimaplatz 5",
  },
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@quieter.email",
      url: "https://quieter.email/home",
    },
  ],
  description:
    "Quieter is an email client that combines your Gmail, shared team mailboxes on your own domain, and transactional sending over an API, with optional AI drafts.",
  logo: "https://quieter.email/icon.svg",
  name: "Quieter",
  sameAs: ["https://x.com/leanderriefel", "https://github.com/leanderriefel"],
  url: "https://quieter.email/",
};

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  head: () => ({
    links: [
      {
        href: "https://fonts.googleapis.com",
        rel: "preconnect",
      },
      {
        crossOrigin: "anonymous",
        href: "https://fonts.gstatic.com",
        rel: "preconnect",
      },
      {
        href: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&family=Geist:wght@100..900&display=swap",
        rel: "stylesheet",
      },
      {
        href: `/favicon${faviconVariant}.ico`,
        rel: "icon",
        sizes: "48x48",
      },
      {
        href: `/icon${faviconVariant}.svg`,
        rel: "icon",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        href: "/apple-touch-icon.png",
        rel: "apple-touch-icon",
        sizes: "180x180",
      },
      {
        href: "/site.webmanifest",
        rel: "manifest",
      },
      {
        color: brand.dark,
        href: "/safari-pinned-tab.svg",
        rel: "mask-icon",
      },
      {
        href: appCssHref,
        rel: "stylesheet",
      },
    ],
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "quieter",
      },
      {
        content: "light dark",
        name: "color-scheme",
      },
      {
        content:
          "Your Gmail, your team's mailboxes and the mail your product sends, in one place.",
        name: "description",
      },
      {
        content: brand.light,
        media: "(prefers-color-scheme: light)",
        name: "theme-color",
      },
      {
        content: brand.dark,
        media: "(prefers-color-scheme: dark)",
        name: "theme-color",
      },
      {
        content: "quieter",
        property: "og:title",
      },
      {
        content: "Quieter",
        property: "og:site_name",
      },
      {
        content: "Email, without the noise.",
        property: "og:description",
      },
      {
        content: "https://quieter.email/og-image.png",
        property: "og:image",
      },
      { content: "1200", property: "og:image:width" },
      { content: "630", property: "og:image:height" },
      {
        content: "Quieter. Email, without the noise.",
        property: "og:image:alt",
      },
      {
        content: "website",
        property: "og:type",
      },
      {
        content: "summary_large_image",
        name: "twitter:card",
      },
      {
        content: "Email, without the noise.",
        name: "twitter:description",
      },
      {
        content: "https://quieter.email/og-image.png",
        name: "twitter:image",
      },
      {
        content: "Quieter. Email, without the noise.",
        name: "twitter:image:alt",
      },
    ],
    scripts: [
      {
        children: JSON.stringify(organizationJsonLd),
        type: "application/ld+json",
      },
    ],
  }),
  notFoundComponent: RootNotFoundComponent,
  shellComponent: RootDocument,
});
