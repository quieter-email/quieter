import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "~/features/legal/components/legal-document-page";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [{ title: "Privacy Policy | Quieter" }],
  }),
});

function PrivacyPage() {
  return (
    <LegalDocumentPage
      description="How Quieter collects, uses, and protects personal data."
      title="Privacy Policy"
    >
      <p>
        Quieter is an email client. This policy describes how we process personal data when you use
        our website, create an account, connect mailboxes, and use billing or AI features.
      </p>

      <h2>Data we process</h2>
      <ul>
        <li>Account data such as your name, email address, and authentication identifiers.</li>
        <li>
          Mailbox content and metadata required to provide inbox, compose, search, and sync
          features.
        </li>
        <li>Billing and subscription data when you purchase a paid plan through Polar.</li>
        <li>
          Error and reliability reports (Sentry) in production to keep the service secure and
          stable. This monitoring is not consent-gated.
        </li>
        <li>
          Performance metrics and limited product analytics only when you consent to measurement
          cookies.
        </li>
      </ul>

      <h2>Processors and integrations</h2>
      <ul>
        <li>Google for identity sign-in and Gmail mailbox authorization.</li>
        <li>Polar for checkout and subscription management.</li>
        <li>PostHog (EU) for product analytics when measurement consent is granted.</li>
        <li>Sentry for error and reliability monitoring.</li>
        <li>Vercel Speed Insights for performance metrics when measurement consent is granted.</li>
        <li>Neon, AWS, and other infrastructure providers that host the service.</li>
        <li>OpenRouter for server-side AI chat generation when you use chat features.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct, delete, or restrict
        processing of your personal data. Contact us at privacy@quieter.email to exercise these
        rights.
      </p>

      <h2>Retention</h2>
      <p>
        We retain account and mailbox data while your account is active and as needed to provide the
        service, comply with law, and resolve disputes.
      </p>
    </LegalDocumentPage>
  );
}
