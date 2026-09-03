import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalDocumentPage } from "#/features/legal/components/legal-document-page";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({
    links: [
      {
        href: "https://quieter.email/contact",
        rel: "canonical",
      },
    ],
    meta: [
      { title: "Contact | Quieter" },
      {
        content:
          "How to reach the Quieter team for support, legal, and other inquiries.",
        name: "description",
      },
      {
        content: "https://quieter.email/contact",
        property: "og:url",
      },
    ],
  }),
});

function ContactPage() {
  return (
    <LegalDocumentPage
      description="How to reach the Quieter team."
      title="Contact"
    >
      <p>
        The fastest way to reach us is by email. We read everything and answer
        within a few business days.
      </p>

      <h2>Support</h2>
      <p>
        For product questions, account help, and bug reports:
        <br />
        <a
          className="underline hover:text-fg"
          href="mailto:support@quieter.email"
        >
          support@quieter.email
        </a>
      </p>

      <h2>Legal and privacy</h2>
      <p>
        For legal requests, privacy questions, and data protection matters:
        <br />
        <a
          className="underline hover:text-fg"
          href="mailto:legal@quieter.email"
        >
          legal@quieter.email
        </a>
      </p>

      <h2>Postal address</h2>
      <p>
        Leander Timon Riefel
        <br />
        Cosimaplatz 5
        <br />
        Berlin, Germany
      </p>

      <h2>Social</h2>
      <ul>
        <li>
          X:{" "}
          <a
            className="underline hover:text-fg"
            href="https://x.com/leanderriefel"
            rel="noreferrer"
            target="_blank"
          >
            @leanderriefel
          </a>
        </li>
        <li>
          GitHub:{" "}
          <a
            className="underline hover:text-fg"
            href="https://github.com/leanderriefel"
            rel="noreferrer"
            target="_blank"
          >
            leanderriefel
          </a>
        </li>
      </ul>

      <p>
        Details about the service provider are listed in the{" "}
        <Link className="underline hover:text-fg" to="/imprint">
          imprint
        </Link>
        .
      </p>
    </LegalDocumentPage>
  );
}
