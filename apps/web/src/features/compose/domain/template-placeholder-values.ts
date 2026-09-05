export const TEMPLATE_PLACEHOLDER_PATTERN =
  /\{\{quieter:(?<label>[^{}\n]{1,80})\}\}/gu;
const TEMPLATE_PLACEHOLDER_HTML_PATTERN =
  /<span\b[^>]*data-quieter-template-placeholder="(?<label>[^"]*)"[^>]*>[^<]*<\/span>/giu;

export const createTemplatePlaceholderToken = (label: string) => {
  const normalized = label
    .replaceAll(/[{}<>&"\n\r]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 80);

  return normalized ? `{{quieter:${normalized}}}` : "";
};

export const hydrateTemplatePlaceholders = (html: string) =>
  html.replaceAll(TEMPLATE_PLACEHOLDER_PATTERN, (_match, rawLabel: string) => {
    const token = createTemplatePlaceholderToken(rawLabel);
    if (!token) {
      return "";
    }
    const label = token.slice("{{quieter:".length, -2);
    return `<span data-quieter-template-placeholder="${label}">${label}</span>`;
  });

export const serializeTemplatePlaceholders = (html: string) =>
  html.replaceAll(TEMPLATE_PLACEHOLDER_HTML_PATTERN, (_match, label: string) =>
    createTemplatePlaceholderToken(label)
  );
