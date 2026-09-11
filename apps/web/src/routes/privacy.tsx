import { createFileRoute } from "@tanstack/react-router";

import { LegalDocumentPage } from "#/features/legal/components/legal-document-page";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    links: [
      {
        href: "https://quieter.email/privacy",
        rel: "canonical",
      },
    ],
    meta: [
      { title: "Privacy Policy | Quieter" },
      {
        content: "https://quieter.email/privacy",
        property: "og:url",
      },
    ],
  }),
});

function PrivacyPage() {
  return (
    <LegalDocumentPage
      description="How Quieter collects, uses, and protects personal data."
      title="Privacy Policy"
    >
      <p>
        Quieter is an email client. This policy describes how we process
        personal data when you use the website, create an account, connect
        mailboxes, send or receive mail, use billing, or enable AI features.
      </p>

      <h2>Controller</h2>
      <p>
        Leander Timon Riefel
        <br />
        Cosimaplatz 5
        <br />
        Berlin, Germany
        <br />
        <a
          className="underline hover:text-fg"
          href="mailto:legal@quieter.email"
        >
          legal@quieter.email
        </a>
      </p>

      <h2>Data we process</h2>
      <ul>
        <li>
          Account data such as your name, email address, and authentication
          identifiers.
        </li>
        <li>
          Organization and membership data needed for teams, mailbox placement,
          and access control.
        </li>
        <li>
          Mailbox content, attachments, headers, labels, recipients, drafts, and
          sync metadata required to provide inbox, compose, search, sending,
          receiving, and mailbox management.
        </li>
        <li>Billing and subscription data when you purchase a paid plan.</li>
        <li>
          Waitlist submissions when you ask to be contacted about access or
          product availability.
        </li>
        <li>
          AI prompts, outputs, and usage metadata when you use chat or enable
          optional Gmail AI features.
        </li>
        <li>
          Error and reliability reports in production to keep the service secure
          and stable. This monitoring is not consent-gated.
        </li>
        <li>
          Browser-local mailbox and navigation metadata, such as mailbox lists,
          labels, and message list metadata, to make recently used mailbox views
          faster.
        </li>
        <li>
          Performance metrics and limited product analytics only when you
          consent to measurement cookies.
        </li>
      </ul>

      <h2>Processors and integrations</h2>
      <ul>
        <li>Google for identity sign-in and Gmail mailbox authorization.</li>
        <li>
          Polar for checkout, subscriptions, billing portal access, and usage
          metering.
        </li>
        <li>
          OpenRouter and selected model providers for optional AI features.
        </li>
        <li>PostHog for product analytics only after measurement consent.</li>
        <li>Sentry for error and reliability monitoring in production.</li>
        <li>
          Hosting, database, mail delivery, and object storage providers used to
          run Quieter.
        </li>
        <li>
          logo.dev for sender logo images where a sender domain logo is
          requested.
        </li>
      </ul>

      <h2>Google API data</h2>
      <p>
        Quieter connects to Google when you sign in with Google or connect a
        Gmail mailbox. Through Google APIs we access the mailbox content needed
        for the features you use: messages, threads, attachments, labels,
        drafts, send and settings data, plus your basic Google profile and email
        address. If you enable the calendar connector, we access the calendar
        events you authorize.
      </p>
      <p>
        We use Google user data only to provide and secure the features you
        request, such as syncing, reading, searching, composing, sending, and
        labeling mail and, when you enable them, optional AI features. We do not
        sell Google user data, use it for advertising, or use it to train
        generalized AI models. Optional AI features process mailbox content
        through the processors listed above, only when you enable those features
        for a mailbox.
      </p>
      <p>
        Gmail credentials are encrypted at rest, mailbox content stays limited
        to the mailbox you connected and to members you explicitly grant access
        to, and we retain Google data only as described under retention. You can
        disconnect a mailbox at any time, which stops future access, and you can
        revoke Google access for Quieter from your{" "}
        <a
          className="underline hover:text-fg"
          href="https://myaccount.google.com/permissions"
        >
          Google Account permissions
        </a>
        . You can request deletion of your Google data by deleting your account
        or contacting{" "}
        <a
          className="underline hover:text-fg"
          href="mailto:legal@quieter.email"
        >
          legal@quieter.email
        </a>
        .
      </p>
      <p>
        The use and transfer to any other app of information received from
        Google APIs by Quieter will adhere to the{" "}
        <a
          className="underline hover:text-fg"
          href="https://developers.google.com/terms/api-services-user-data-policy"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Why we process data</h2>
      <ul>
        <li>To provide and secure the service you request.</li>
        <li>To operate organizations, mailbox access, billing, and support.</li>
        <li>To comply with legal obligations and prevent abuse.</li>
        <li>
          To measure product usage and performance only when you consent to
          measurement.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct,
        delete, or restrict processing of your personal data. Contact us at{" "}
        <a
          className="underline hover:text-fg"
          href="mailto:legal@quieter.email"
        >
          legal@quieter.email
        </a>{" "}
        to exercise these rights.
      </p>

      <h2>Retention</h2>
      <p>
        We retain account and mailbox data while your account is active and as
        needed to provide the service, comply with law, prevent abuse, and
        resolve disputes. Turning off Gmail useful details deletes stored
        useful-detail items for that mailbox. Disabling a mailbox or deleting
        account data may not immediately remove backups, logs, invoices, or
        records we must keep for legal, security, or accounting reasons. The
        browser may keep selected mailbox and navigation metadata in
        localStorage for up to 24 hours; signing out or deleting your account
        clears this query cache from the browser.
      </p>

      <h2>International transfers</h2>
      <p>
        Quieter is operated from Germany, but some processors may store or
        process data outside Germany or the European Union. Where required, we
        rely on appropriate safeguards offered by those processors.
      </p>
    </LegalDocumentPage>
  );
}
