import { handleTrpcRequest } from "@quietr/trpc/server";

export const runtime = "nodejs";

const endpoint = "/api/trpc";
const handler = (request: Request) => handleTrpcRequest(request, endpoint);

export { handler as GET, handler as POST };
