/// <reference types="vite/client" />

import { createRootRoute } from "@tanstack/react-router";
import { RootComponent } from "~/components/root/root-component";
import { RootErrorComponent } from "~/components/root/root-error-component";
import { RootNotFoundComponent } from "~/components/root/root-not-found-component";
import appCss from "~/styles.css?url";

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
        href: "/favicon.ico",
        rel: "icon",
        sizes: "48x48",
      },
      {
        href: "/icon.svg",
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
        color: "#1a1a1a",
        href: "/safari-pinned-tab.svg",
        rel: "mask-icon",
      },
      {
        href: appCss,
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
        content: "#f7f4ee",
        media: "(prefers-color-scheme: light)",
        name: "theme-color",
      },
      {
        content: "#141414",
        media: "(prefers-color-scheme: dark)",
        name: "theme-color",
      },
      {
        content: "quieter",
        property: "og:title",
      },
      {
        content: "Email, without the noise.",
        property: "og:description",
      },
      {
        content: "/og-image.png",
        property: "og:image",
      },
      {
        content: "summary_large_image",
        name: "twitter:card",
      },
      {
        content: "/og-image.png",
        name: "twitter:image",
      },
    ],
  }),
  notFoundComponent: RootNotFoundComponent,
});
