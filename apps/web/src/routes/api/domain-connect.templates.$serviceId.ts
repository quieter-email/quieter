import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/domain-connect/templates/$serviceId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { createDomainConnectTemplate, domainConnectModes, getDomainConnectService } =
          await import("@quieter/orpc/domain-connect-template");

        const mode = domainConnectModes.find(
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
