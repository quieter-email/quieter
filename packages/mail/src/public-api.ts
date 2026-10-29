export const API_COMPATIBILITY_DATE = "2026-10" as const;
export const API_VERSION_HEADER = "Quieter-Version" as const;

export const SEND_API_PATH = "/api/send" as const;
export const MCP_API_PATH = "/api/mcp" as const;
export const SUPPRESSIONS_API_PATH = "/api/suppressions" as const;
export const MESSAGES_API_PATH = "/api/messages" as const;
export const OPEN_TRACKING_PATH_PREFIX = "/api/o" as const;

export const rejectApiCompatibility = (headers: Headers): Response | null => {
  const sent = headers.get(API_VERSION_HEADER)?.trim() ?? "";
  if (sent === API_COMPATIBILITY_DATE) {
    return null;
  }

  return Response.json(
    {
      error: `Send the ${API_VERSION_HEADER} header set to ${API_COMPATIBILITY_DATE}.`,
    },
    {
      headers: { [API_VERSION_HEADER]: API_COMPATIBILITY_DATE },
      status: 400,
    }
  );
};

export const stampApiCompatibility = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set(API_VERSION_HEADER, API_COMPATIBILITY_DATE);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
