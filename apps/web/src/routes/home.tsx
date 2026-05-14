import { LinkButton } from "@quieter/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { domAnimation, LazyMotion, m } from "motion/react";
import { ContourLines } from "~/components/contour-lines";
import { getSessionUser } from "~/lib/auth.functions";

export const Route = createFileRoute("/home")({
  loader: async () => {
    const user = await getSessionUser();

    if (user) {
      throw redirect({
        to: "/",
      });
    }
  },
  component: HomePage,
});

function HomePage() {
  return (
    <LazyMotion features={domAnimation}>
      <div className="relative isolate min-h-dvh w-full">
        <div className="relative z-10 grid min-h-dvh w-full place-items-center">
          <div className="flex h-[90vh] w-2/3 flex-col items-center gap-y-10">
            <h1 className="mt-[15vh] max-w-xl text-center text-6xl font-semibold text-balance">
              <m.p
                initial={{ opacity: 0, y: 20, filter: "blur(20px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0, duration: 0.8, ease: "easeOut" }}
                className="will-change-[transform,opacity,filter]"
              >
                Your inbox just got
              </m.p>
              <m.p
                initial={{ opacity: 0, y: 20, filter: "blur(20px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
                className="will-change-[transform,opacity,filter]"
              >
                a whole lot{" "}
                <m.span
                  className="relative inline-block bg-transparent"
                  animate={{
                    color: [
                      "oklch(0.6 0.15 0)",
                      "oklch(0.6 0.15 120)",
                      "oklch(0.6 0.15 240)",
                      "oklch(0.6 0.15 360)",
                    ],
                  }}
                  transition={{
                    duration: 10,
                    repeat: Infinity,
                  }}
                >
                  quieter
                </m.span>
              </m.p>
            </h1>
            <m.h2
              initial={{ opacity: 0, y: 20, filter: "blur(20px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
              className="text-center text-base font-light text-balance will-change-[transform,opacity,filter]"
            >
              Just want a modern email client? Or need to manage your whole companies support inbox?
              We&apos;ve got you covered.
            </m.h2>
            <m.div
              initial={{ opacity: 0, y: 20, filter: "blur(20px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.9, duration: 0.8, ease: "easeOut" }}
              className="will-change-[transform,opacity,filter]"
            >
              <LinkButton to="/auth" search={{ mode: "signup" }}>
                Get Started
              </LinkButton>
            </m.div>
          </div>
        </div>
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="fixed top-0 left-0 h-dvh w-dvw"
        >
          <ContourLines />
          <div className="absolute inset-0 z-0 bg-[radial-gradient(125%_125%_at_50%_10%,transparent_40%,#475569_100%)]" />
        </m.div>
      </div>
    </LazyMotion>
  );
}
