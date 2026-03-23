const normalizeRelativePath = (value: string | null | undefined) => {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !normalizedValue.startsWith("/") || normalizedValue.startsWith("//")) {
    return "/";
  }

  return normalizedValue;
};

export const getGoogleScopeRepairReturnTo = (value: string | null | undefined) => {
  return normalizeRelativePath(value);
};

export const getGoogleScopeRepairPageHref = (input: {
  from?: string | null;
  returned?: boolean;
  targetAccountId: string;
}) => {
  const params = new URLSearchParams({
    targetAccountId: input.targetAccountId,
  });
  const from = normalizeRelativePath(input.from);

  if (from !== "/") {
    params.set("from", from);
  }

  if (input.returned) {
    params.set("returned", "1");
  }

  return `/google-scope-repair?${params.toString()}`;
};

export const getGoogleScopeRepairStartHref = (input: {
  from?: string | null;
  targetAccountId: string;
}) => {
  const params = new URLSearchParams({
    targetAccountId: input.targetAccountId,
  });
  const from = normalizeRelativePath(input.from);

  if (from !== "/") {
    params.set("from", from);
  }

  return `/api/auth/google-scope-repair?${params.toString()}`;
};
