import { LinkButton } from "@quieter/ui";
import { domAnimation, LazyMotion, m } from "motion/react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { WaitlistForm } from "./waitlist-form";

export const HomePage = () => (
  <LazyMotion features={domAnimation}>
    <m.div
      initial={{ opacity: 0, filter: "blur(8px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 1.2, ease: "easeOut" }}
      className="quieter-workspace-background relative isolate min-h-dvh w-full bg-neutral-950 text-white will-change-[opacity,filter] [--background:#0a0a0a]"
    >
      <LinkButton
        className="fixed top-4 right-4 z-20 h-8 border-white/15 bg-white/5 px-3 text-xs text-white/50 shadow-none backdrop-blur-sm hover:bg-white/10 hover:text-white/80"
        search={{ returnTo: "/auth" }}
        to="/site-password"
        variant="outline"
      >
        Access
      </LinkButton>
      <div className="relative z-10 grid min-h-dvh w-full place-items-center px-6 py-16">
        <div className="relative flex w-full max-w-5xl flex-col items-center justify-center gap-y-10 min-[2560px]:max-w-6xl min-[2560px]:gap-y-11">
          <h1 className="max-w-3xl text-center text-[3.25rem] leading-[0.95] font-semibold text-balance text-white min-[1920px]:max-w-4xl min-[1920px]:text-[3.875rem] min-[2560px]:text-[4.25rem] sm:text-6xl">
            <m.span
              initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0, duration: 0.8, ease: "easeOut" }}
              className="block will-change-[transform,opacity,filter]"
            >
              Your inbox just got
            </m.span>
            <m.span
              initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
              className="block will-change-[transform,opacity,filter]"
            >
              a whole lot{" "}
              <m.span
                className="relative inline-block"
                animate={{
                  color: [
                    "oklch(0.75 0.15 280)",
                    "oklch(0.75 0.15 330)",
                    "oklch(0.75 0.15 385)",
                    "oklch(0.75 0.15 330)",
                    "oklch(0.75 0.15 280)",
                  ],
                }}
                transition={{
                  duration: 10,
                  repeat: Infinity,
                }}
              >
                quieter
              </m.span>
            </m.span>
          </h1>
          <m.h2
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
            className="w-full text-center text-base/7 font-light text-balance text-white/60 will-change-[transform,opacity,filter] min-[900px]:whitespace-nowrap min-[2560px]:text-[17px]"
          >
            Just want a modern email client? Or need to manage your whole company&apos;s support
            inbox? We&apos;ve got you covered.
          </m.h2>
          <m.div
            initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.9, duration: 0.8, ease: "easeOut" }}
            className="w-full max-w-sm scroll-mt-12 will-change-[transform,opacity,filter] min-[2560px]:max-w-104"
            id="waitlist"
          >
            <WaitlistForm />
          </m.div>
        </div>
      </div>
      <WorkspaceDitherBackground
        dotRgb="21, 21, 21"
        falloff={2.35}
        opacity={1}
        pattern="opposing-corners"
        strength={14}
      />
    </m.div>
  </LazyMotion>
);
