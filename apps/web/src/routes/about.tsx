import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalDocumentPage } from "#/features/legal/components/legal-document-page";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => ({
    links: [
      {
        href: "https://quieter.email/about",
        rel: "canonical",
      },
    ],
    meta: [
      { title: "About | Quieter" },
      {
        content:
          "Quieter is an email client for Gmail, shared team mailboxes, and transactional sending.",
        name: "description",
      },
      {
        content: "https://quieter.email/about",
        property: "og:url",
      },
    ],
  }),
});

function AboutPage() {
  return (
    <LegalDocumentPage description="Who builds Quieter and why." title="About">
      <p>
        Quieter is an email client built around one idea: email can do more
        without asking more from you. It brings the mail you already use, the
        mail your team shares, and the mail your product sends into a single
        calm place instead of asking you to migrate or rebuild anything.
      </p>

      <h2>What Quieter does</h2>
      <ul>
        <li>
          Connects to Gmail with two-way sync, so your existing mailbox stays
          exactly where it is.
        </li>
        <li>
          Gives teams shared mailboxes on their own domain, such as support@,
          billing@, and press@, with roles and clear ownership.
        </li>
        <li>
          Sends transactional product email from verified domains over a REST
          API, with delivery tracking and suppression handling built in.
        </li>
        <li>
          Offers AI drafts and context inside a single mailbox. AI assistance is
          optional, per person, and you always send the result yourself.
        </li>
      </ul>

      <h2>Principles</h2>
      <p>
        Quieter keeps provider details behind simple interfaces, treats your
        mailbox as private to its owner unless you explicitly share it, and
        avoids attention-grabbing patterns. The product is developed by Leander
        Timon Riefel in Berlin, Germany.
      </p>

      <h2>Status</h2>
      <p>
        Quieter is in private preview. You can join the waitlist on the{" "}
        <Link className="underline hover:text-fg" to="/home">
          landing page
        </Link>{" "}
        to be notified when access opens.
      </p>
    </LegalDocumentPage>
  );
}
