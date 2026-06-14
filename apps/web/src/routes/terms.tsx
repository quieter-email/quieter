import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "~/features/legal/components/legal-document-page";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [{ title: "Terms of Service | Quieter" }],
  }),
});

function TermsPage() {
  return (
    <LegalDocumentPage
      description="Terms governing your use of the Quieter email service."
      title="Terms of Service"
    >
      <p>
        By creating a Quieter account, you agree to these Terms of Service and our Privacy Policy.
        If you do not agree, do not use the service.
      </p>

      <h2>The service</h2>
      <p>
        Quieter provides email client functionality for Gmail and managed mailboxes, including inbox
        management, compose, search, organization features, and optional AI-assisted chat and Gmail
        labeling.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Provide accurate account information and keep your credentials secure.</li>
        <li>Use the service lawfully and respect the rights of others.</li>
        <li>Ensure you have authority to connect mailboxes and send messages through them.</li>
      </ul>

      <h2>Availability and changes</h2>
      <p>
        We may update the service and these terms. Material changes will be communicated through the
        product or by email where appropriate.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: legal@quieter.email</p>
    </LegalDocumentPage>
  );
}
