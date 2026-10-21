import type { ChatModelGroup } from "@quieter/ai/chat-models";

const labLogos = {
  anthropic: "anthropic",
  deepseek: "deepseek",
  google: "google",
  moonshotai: "moonshot",
  openai: "openai",
  "z-ai": "zai",
} satisfies Record<ChatModelGroup, string>;

export const ModelLabLogo = ({ lab }: { lab: ChatModelGroup }) => (
  <img
    alt=""
    aria-hidden
    className="size-3.5 shrink-0 dark:invert"
    src={`/model-labs/${labLogos[lab]}.svg`}
  />
);
