import { handleOrpcRequest } from "@quietr/orpc/server";

export const runtime = "nodejs";

const endpoint = "/api/orpc";
const handler = (request: Request) => handleOrpcRequest(request, endpoint);

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
