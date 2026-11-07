import type { RouterOutputs } from "@quieter/orpc";
import { Text } from "@quieter/ui/text";

type Provenance =
  RouterOutputs["ai"]["memories"]["items"][number]["provenance"];
const sourceLabels = {
  explicit: "Saved by you",
  feedback: "Learned from feedback",
  inferred: "Learned from your activity",
  migration: "Imported",
} satisfies Record<Provenance["source"], string>;
const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export const MemoryProvenance = ({
  details = false,
  provenance,
}: {
  details?: boolean;
  provenance: Provenance;
}) => (
  <div className="space-y-1">
    <Text size="caption" tone="muted">
      {sourceLabels[provenance.source]}, last supported{" "}
      {dateFormatter.format(new Date(provenance.lastConfirmedAt))}
    </Text>
    {details ? (
      <Text size="caption" tone="muted">
        Added {dateFormatter.format(new Date(provenance.createdAt))}
        {provenance.expiresAt
          ? `, expires ${dateFormatter.format(new Date(provenance.expiresAt))}`
          : ""}
      </Text>
    ) : null}
  </div>
);
