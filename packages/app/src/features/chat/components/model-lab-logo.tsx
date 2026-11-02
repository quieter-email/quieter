import type { ChatModelGroup } from "@quieter/ai/chat-models";

const labLogos = {
  anthropic: new URL(
    "../../../assets/model-labs/anthropic.svg",
    import.meta.url
  ).href,
  deepseek: new URL("../../../assets/model-labs/deepseek.svg", import.meta.url)
    .href,
  google: new URL("../../../assets/model-labs/google.svg", import.meta.url)
    .href,
  moonshotai: new URL(
    "../../../assets/model-labs/moonshot.svg",
    import.meta.url
  ).href,
  openai: new URL("../../../assets/model-labs/openai.svg", import.meta.url)
    .href,
  "z-ai": new URL("../../../assets/model-labs/zai.svg", import.meta.url).href,
} satisfies Record<ChatModelGroup, string>;

export const ModelLabLogo = ({ lab }: { lab: ChatModelGroup }) => (
  <img
    alt=""
    aria-hidden
    className="size-3.5 shrink-0 dark:invert"
    src={labLogos[lab]}
  />
);
