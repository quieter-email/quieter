// Known AI crawler and agent user agents that should reach public marketing
// content even while the site password gate is enabled. Matched as lowercase
// substrings; every token is distinctive enough to avoid user-facing collisions.
const aiCrawlerTokens = [
  "amazonbot",
  "anthropic-ai",
  "applebot",
  "bytespider",
  "ccbot",
  "chatgpt-user",
  "claudebot",
  "cohere-ai",
  "deepseekbot",
  "diffbot",
  "google-extended",
  "gptbot",
  "is-agentic",
  "meta-externalagent",
  "oai-searchbot",
  "omgili",
  "ora-agent",
  "perplexity-user",
  "perplexitybot",
  "youbot",
] as const;

const aiCrawlerRegExp = new RegExp(`(?:${aiCrawlerTokens.join("|")})`, "u");

export const isAiCrawlerUserAgent = (userAgent: string | null | undefined) =>
  userAgent === null || userAgent === undefined
    ? false
    : aiCrawlerRegExp.test(userAgent.toLowerCase());

export const isAiCrawlerRequest = (request: Request) =>
  isAiCrawlerUserAgent(request.headers.get("user-agent"));

export const prefersMarkdown = (request: Request) =>
  (request.headers.get("accept") ?? "").toLowerCase().includes("text/markdown");
