const assetLoadErrorPattern =
  /^(?:Failed to fetch dynamically imported module:|error loading dynamically imported module:|Importing a module script failed\.?$|Unable to preload CSS for )/iu;

export const isDeploymentAssetError = (error: unknown): boolean => {
  let current = error;
  const visited = new Set<unknown>();

  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    if (
      "message" in current &&
      typeof current.message === "string" &&
      assetLoadErrorPattern.test(current.message)
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
};
