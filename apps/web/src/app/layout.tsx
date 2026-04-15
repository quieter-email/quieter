import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "~/components/providers";
import "../lib/orpc.server";
import "~/styles.css";

const faviconHref =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230f172a'/%3E%3Ctext x='32' y='41' text-anchor='middle' font-size='30' fill='white'%3Eq%3C/text%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: "quietr",
  icons: [{ type: "image/svg+xml", url: faviconHref }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
