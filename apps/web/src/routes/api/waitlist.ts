import { db, waitlistSignup } from "@quieter/database";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/waitlist")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        const createdSignups = await db
          .insert(waitlistSignup)
          .values({
            createdAt: new Date(),
            email: email.data,
          })
          .onConflictDoNothing({
            target: waitlistSignup.email,
          })
          .returning({
            email: waitlistSignup.email,
          });

        const status = createdSignups.length > 0 ? "created" : "existing";

        if (wantsJson)
          return Response.json({
            email: email.data,
            status,
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
