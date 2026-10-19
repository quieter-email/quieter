import type { Campaign } from "@quieter/mail/campaigns";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";

const tones = {
  canceled: "gray",
  completed: "green",
  draft: "gray",
  paused: "orange",
  queued: "blue",
  sending: "blue",
} satisfies Record<Campaign["status"], PillTone>;

export const CampaignStatus = ({ status }: { status: Campaign["status"] }) => (
  <Pill tone={tones[status]}>{status}</Pill>
);
