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
        the website, create an account, connect mailboxes, send or receive mail, use billing, or
        enable AI features.
      </p>

      <h2>Controller</h2>
      <p>
        Leander Timon Riefel
        <br />
        Cosimaplatz 5
        <br />
        Berlin, Germany
        <br />
        <a className="underline hover:text-foreground" href="mailto:legal@quieter.email">
          legal@quieter.email
        </a>
      </p>

      <h2>Data we process</h2>
      <ul>
        <li>Account data such as your name, email address, and authentication identifiers.</li>
        <li>
          Organization and membership data needed for teams, mailbox placement, and access control.
        </li>
        <li>
          Mailbox content, attachments, headers, labels, recipients, drafts, and sync metadata
          required to provide inbox, compose, search, sending, receiving, and mailbox management.
        </li>
        <li>Billing and subscription data when you purchase a paid plan.</li>
        <li>
          Waitlist submissions when you ask to be contacted about access or product availability.
        </li>
        <li>
          AI prompts, outputs, and usage metadata when you use chat or enable optional Gmail AI
          features.
        </li>
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
        <li>Polar for checkout, subscriptions, billing portal access, and credit metering.</li>
        <li>OpenRouter and selected model providers for optional AI features.</li>
        <li>PostHog for product analytics only after measurement consent.</li>
        <li>Sentry for error and reliability monitoring in production.</li>
        <li>Vercel Speed Insights for performance measurement only after measurement consent.</li>
        <li>Hosting, database, mail delivery, and object storage providers used to run Quieter.</li>
        <li>logo.dev for sender logo images where a sender domain logo is requested.</li>
      </ul>

      <h2>Why we process data</h2>
      <ul>
        <li>To provide and secure the service you request.</li>
        <li>To operate organizations, mailbox access, billing, and support.</li>
        <li>To comply with legal obligations and prevent abuse.</li>
        <li>To measure product usage and performance only when you consent to measurement.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct, delete, or restrict
        processing of your personal data. Contact us at{" "}
        <a className="underline hover:text-foreground" href="mailto:legal@quieter.email">
          legal@quieter.email
        </a>{" "}
        to exercise these rights.
      </p>

      <h2>Retention</h2>
      <p>
        We retain account and mailbox data while your account is active and as needed to provide the
        service, comply with law, prevent abuse, and resolve disputes. Turning off Gmail useful
        details deletes stored useful-detail items for that mailbox. Disabling a mailbox or deleting
        account data may not immediately remove backups, logs, invoices, or records we must keep for
        legal, security, or accounting reasons.
      </p>

      <h2>International transfers</h2>
      <p>
        Quieter is operated from Germany, but some processors may store or process data outside
        Germany or the European Union. Where required, we rely on appropriate safeguards offered by
        those processors.
      </p>
    </LegalDocumentPage>
  );
}
