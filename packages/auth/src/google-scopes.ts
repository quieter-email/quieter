export const REQUIRED_GOOGLE_SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

const normalizeGrantedScopes = (
  grantedScopes: readonly string[] | string | null | undefined,
): string[] => {
  if (typeof grantedScopes === "string") {
    return grantedScopes
      .split(/[,\s]+/g)
      .map((scope: string) => scope.trim())
      .filter(Boolean);
  }

  if (Array.isArray(grantedScopes)) {
    return grantedScopes.map((scope) => scope.trim()).filter(Boolean);
  }

  return [];
};

export const hasRequiredGoogleScopes = (
  grantedScopes: readonly string[] | string | null | undefined,
): boolean => {
  const grantedScopeSet = new Set(normalizeGrantedScopes(grantedScopes));
  return REQUIRED_GOOGLE_SCOPES.every((scope) => grantedScopeSet.has(scope));
};
