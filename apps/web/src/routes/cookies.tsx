import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "~/features/legal/components/legal-document-page";

export const Route = createFileRoute("/cookies")({
  component: CookiesPage,
  head: () => ({
    meta: [{ title: "Cookie Policy | Quieter" }],
  }),
});

function CookiesPage() {
  return (
    <LegalDocumentPage
      description="How Quieter uses cookies and similar technologies."
      title="Cookie Policy"
    >
      <p>
        Cookies are small files stored on your device. We use cookies and similar storage to operate
        Quieter, remember your preferences, and—only with consent—measure product usage.
      </p>

      <h2>Strictly necessary</h2>
      <ul>
        <li>Authentication session cookies that keep you signed in.</li>
        <li>Consent preference storage managed by our consent platform.</li>
        <li>Site access cookies when a preview password gate is enabled.</li>
      </ul>

      <h2>Measurement (consent required)</h2>
      <ul>
        <li>PostHog analytics cookies for page views and identified usage in production.</li>
        <li>Vercel Speed Insights for performance measurement.</li>
      </ul>

      <h2>Manage preferences</h2>
      <p>
        You can accept or reject non-essential cookies from the banner on your first visit and
        change your choice at any time from the footer link or Settings.
      </p>
    </LegalDocumentPage>
  );
}
