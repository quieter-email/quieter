import {
  createDomainConnectTemplate,
  getDomainConnectService,
} from "@quieter/orpc/domain-connect-template";
import { createFileRoute } from "@tanstack/react-router";

const modes = ["send_only", "send_and_receive"] as const;

export const Route = createFileRoute("/api/domain-connect/templates/$serviceId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const mode = modes.find(
          (candidate) => getDomainConnectService(candidate).id === params.serviceId,
        );
        if (!mode) {
          return Response.json({ error: "Template not found." }, { status: 404 });
        }
        return Response.json(createDomainConnectTemplate(mode), {
          headers: {
            "cache-control": "public, max-age=300, s-maxage=3600",
          },
        });
      },
    },
  },
});
