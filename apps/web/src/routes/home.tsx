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
      <div className="relative isolate min-h-dvh w-full">
        <LinkButton
          className="fixed top-4 right-4 z-20 h-8 border-foreground/10 bg-background/10 px-3 text-xs text-foreground/35 shadow-none backdrop-blur-sm hover:bg-background/25 hover:text-foreground/60"
          search={{ returnTo: "/auth" }}
          to="/site-password"
          variant="outline"
        >
          Access
        </LinkButton>
        <div className="relative z-10 grid min-h-dvh w-full place-items-center">
          <div className="flex h-[90vh] w-2/3 flex-col items-center gap-y-10 max-sm:w-full max-sm:px-6">
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
              className="w-full max-w-sm will-change-[transform,opacity,filter]"
            >
              <WaitlistForm />
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
        <FieldLabel htmlFor="waitlist-email">Join the waitlist</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            chrome="primary"
            disabled={iconState === "loading"}
            id="waitlist-email"
            name="email"
            placeholder="you@example.com"
            required
            size="sm"
            type="text"
          />
          <IconButtonTooltip label="Join waitlist">
            <Button
              aria-label="Join waitlist"
              disabled={iconState === "loading"}
              size="icon-sm"
              type="submit"
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
