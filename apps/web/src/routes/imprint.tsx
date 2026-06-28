import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "~/features/legal/components/legal-document-page";

export const Route = createFileRoute("/imprint")({
  component: ImprintPage,
  head: () => ({
    meta: [{ title: "Imprint | Quieter" }],
  }),
});

function ImprintPage() {
  return (
    <LegalDocumentPage
      description="Legal information about the operator of Quieter."
      title="Imprint"
    >
      <h2>Service provider</h2>
      <p>
        Leander Timon Riefel
        <br />
        Cosimaplatz 5
        <br />
        Berlin, Germany
      </p>

      <h2>Contact</h2>
      <p>
        Support:{" "}
        <a className="underline hover:text-foreground" href="mailto:support@quieter.email">
          support@quieter.email
        </a>
        <br />
        Legal:{" "}
        <a className="underline hover:text-foreground" href="mailto:legal@quieter.email">
          legal@quieter.email
        </a>
      </p>

      <h2>Social</h2>
      <ul>
        <li>
          X:{" "}
          <a
            className="underline hover:text-foreground"
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
            className="underline hover:text-foreground"
            href="https://github.com/leanderriefel"
            rel="noreferrer"
            target="_blank"
          >
            leanderriefel
          </a>
        </li>
      </ul>
    </LegalDocumentPage>
  );
}
