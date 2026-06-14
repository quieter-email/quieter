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
        <li>Billing and subscription data when you purchase a paid plan.</li>
        <li>
          Error and reliability reports in production to keep the service secure and stable. This
          monitoring is not consent-gated.
        </li>
        <li>
          Performance metrics and limited product analytics only when you consent to measurement
          cookies.
        </li>
      </ul>

      <h2>Processors and integrations</h2>
      <ul>
        <li>Google for identity sign-in and Gmail mailbox authorization.</li>
        <li>Payment services for checkout and subscription management.</li>
        <li>Product analytics services when measurement consent is granted.</li>
        <li>Error and reliability monitoring services.</li>
        <li>Performance measurement services when measurement consent is granted.</li>
        <li>Cloud hosting and database services that operate Quieter.</li>
        <li>
          AI processing services for chat generation and, when enabled, Gmail auto-labeling and
          useful detail extraction.
        </li>
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
