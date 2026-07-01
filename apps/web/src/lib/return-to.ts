const SAFE_RETURN_TO_ORIGIN = "https://quieter.local";

export const getSafeAuthReturnTo = (value: string | null | undefined) => {
  const trimmed = value?.trim();

  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return undefined;
  }

  try {
    const url = new URL(trimmed, SAFE_RETURN_TO_ORIGIN);

    if (url.origin !== SAFE_RETURN_TO_ORIGIN) {
      return undefined;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
};
