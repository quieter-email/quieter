export const regionalTimeFormat = (
  acceptLanguage?: string | null
): "12h" | "24h" => {
  const languages = (acceptLanguage ?? "")
    .split(",")
    .map((entry) => {
      const [language, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q=")
      );
      return {
        language: language?.trim() ?? "",
        quality: quality ? Number(quality.trim().slice(2)) : 1,
      };
    })
    .filter(
      ({ quality }) => Number.isFinite(quality) && quality > 0 && quality <= 1
    )
    .toSorted((a, b) => b.quality - a.quality);

  for (const { language } of languages) {
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([language]).length === 0) {
        continue;
      }
      return new Intl.DateTimeFormat(language, {
        hour: "numeric",
      }).resolvedOptions().hour12 === true
        ? "12h"
        : "24h";
    } catch {
      // Invalid or wildcard language ranges do not identify a regional preference.
    }
  }
  return "24h";
};
