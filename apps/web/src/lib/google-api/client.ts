type QueryPrimitive = string | number | boolean | null | undefined;

export type GoogleApiQueryParams = Record<string, QueryPrimitive | QueryPrimitive[]>;

export const appendQueryParams = (url: URL, query: GoogleApiQueryParams | undefined) => {
  if (!query) return;

  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    for (const value of values) {
      if (value == null) continue;
      url.searchParams.append(key, String(value));
    }
  }
};
