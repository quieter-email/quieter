import { Add01Icon, Cancel01Icon, Loading03Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Button,
  Field,
  FieldLabel,
  IconButtonTooltip,
  Input,
  LinkButton,
  toast,
} from "@quieter/ui";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useState, type SubmitEvent } from "react";
import { ContourLines } from "~/components/contour-lines";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

function HomePage() {
  return (
    <LazyMotion features={domAnimation}>
      <m.div
        initial={{ opacity: 0, filter: "blur(12px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 1.2, ease: "easeOut" }}
        className="relative isolate min-h-dvh w-full bg-black will-change-[opacity,filter]"
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
          <div className="absolute inset-0 bg-[radial-gradient(48%_42%_at_50%_50%,rgba(0,0,0,0.92)_0%,rgba(0,0,0,0.68)_48%,rgba(0,0,0,0.18)_72%,transparent_100%)]" />
          <div className="relative flex w-full max-w-5xl flex-col items-center justify-center gap-y-10 min-[2560px]:max-w-6xl min-[2560px]:gap-y-11">
            <h1 className="max-w-3xl text-center text-6xl leading-[0.95] font-semibold text-balance text-white min-[1920px]:max-w-4xl min-[1920px]:text-[3.875rem] min-[2560px]:text-[4.25rem]">
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
              </m.p>
            </h1>
            <m.h2
              initial={{ opacity: 0, y: 20, filter: "blur(20px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
              className="w-full text-center text-base leading-7 font-light text-balance text-white/60 will-change-[transform,opacity,filter] min-[900px]:whitespace-nowrap min-[2560px]:text-[17px]"
            >
              Just want a modern email client? Or need to manage your whole companies support inbox?
              We&apos;ve got you covered.
            </m.h2>
            <m.div
              initial={{ opacity: 0, y: 20, filter: "blur(20px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.9, duration: 0.8, ease: "easeOut" }}
              className="w-full max-w-sm will-change-[transform,opacity,filter] min-[2560px]:max-w-[26rem]"
            >
              <WaitlistForm />
            </m.div>
          </div>
        </div>
        <div className="fixed top-0 left-0 h-dvh w-dvw">
          <ContourLines />
        </div>
      </m.div>
    </LazyMotion>
  );
}

type WaitlistIconState = "error" | "idle" | "loading" | "success";

type WaitlistResponse = {
  email: string;
  status: "created" | "existing";
};

function WaitlistForm() {
  const [iconState, setIconState] = useState<WaitlistIconState>("idle");

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    setIconState("loading");

    const request = addToWaitlist(new FormData(form));

    toast.promise(request, {
      error: "Something went wrong. Try again.",
      loading: "Adding you to the waitlist...",
      success: (response) =>
        response.status === "existing"
          ? "You're already on the waitlist."
          : `Added ${response.email} to the waitlist.`,
    });

    void request
      .then(() => {
        form.reset();
        setIconState("success");
      })
      .catch(() => {
        setIconState("error");
      })
      .finally(() => {
        window.setTimeout(() => setIconState("idle"), 1600);
      });
  };

  return (
    <form action="/api/waitlist" className="grid gap-2" method="post" onSubmit={handleSubmit}>
      <Field>
        <FieldLabel className="text-white/70 min-[2560px]:text-[15px]" htmlFor="waitlist-email">
          Join the waitlist
        </FieldLabel>
        <div className="relative">
          <Input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className="h-9 border-white/15 bg-white/5 pr-11 text-sm text-white placeholder:text-white/30 min-[2560px]:h-10 min-[2560px]:pr-12 min-[2560px]:text-[15px]"
            disabled={iconState === "loading"}
            id="waitlist-email"
            name="email"
            placeholder="you@example.com"
            required
            type="text"
          />
          <IconButtonTooltip label="Join waitlist">
            <Button
              aria-label="Join waitlist"
              className="absolute top-1/2 right-1 !size-7 -translate-y-1/2 bg-transparent text-white/70 shadow-none hover:bg-white/10 hover:text-white min-[2560px]:right-1.5 min-[2560px]:!size-8"
              disabled={iconState === "loading"}
              size="icon-sm"
              type="submit"
              variant="ghost"
            >
              <WaitlistSubmitIcon state={iconState} />
            </Button>
          </IconButtonTooltip>
        </div>
      </Field>
    </form>
  );
}

const addToWaitlist = async (formData: FormData): Promise<WaitlistResponse> => {
  const response = await fetch("/api/waitlist", {
    body: formData,
    headers: {
      accept: "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Could not add waitlist signup.");
  }

  return await response.json();
};

const waitlistIcons: Record<WaitlistIconState, IconSvgElement> = {
  error: Cancel01Icon,
  idle: Add01Icon,
  loading: Loading03Icon,
  success: Tick01Icon,
};

function WaitlistSubmitIcon({ state }: { state: WaitlistIconState }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <m.span
        animate={{ opacity: 1, scale: 1 }}
        className="grid place-items-center will-change-[transform,opacity]"
        exit={{ opacity: 0, scale: 0.9 }}
        initial={{ opacity: 0.5, scale: 0.9 }}
        key={state}
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        <HugeiconsIcon
          aria-hidden
          className={state === "loading" ? "size-3.5 animate-spin" : "size-3.5"}
          icon={waitlistIcons[state]}
        />
      </m.span>
    </AnimatePresence>
  );
}
