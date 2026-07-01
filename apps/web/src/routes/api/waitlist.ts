import { recordWaitlistSignup } from "@quieter/orpc/waitlist";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/waitlist")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
        const acceptsFormData =
          contentType.startsWith("application/x-www-form-urlencoded") ||
          contentType.startsWith("multipart/form-data");
        if (!acceptsFormData) {
          return Response.json(
            { message: "Submit the waitlist form using form data." },
            { status: 415 },
          );
        }

        const formData = await request.formData();
        const email = z.email().trim().safeParse(formData.get("email"));
        const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");

        if (!email.success) {
          if (wantsJson)
            return Response.json({ message: "Enter a valid email address." }, { status: 400 });

          const url = new URL("/home", request.url);
          url.searchParams.set("waitlist", "invalid");
          return new Response(null, {
            headers: {
              location: `${url.pathname}${url.search}`,
            },
            status: 302,
          });
        }

        const signup = await recordWaitlistSignup(email.data);

        if (wantsJson)
          return Response.json({
            email: signup.email,
            status: signup.status,
          });

        const url = new URL("/home", request.url);
        url.searchParams.set("waitlist", "joined");
        return new Response(null, {
          headers: {
            location: `${url.pathname}${url.search}`,
          },
          status: 302,
        });
      },
    },
  },
});
