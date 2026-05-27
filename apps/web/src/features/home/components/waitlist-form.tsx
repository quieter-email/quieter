import { Button, Field, FieldLabel, IconButtonTooltip, Input, toast } from "@quieter/ui";
import { useState, type SubmitEvent } from "react";
import { type WaitlistIconState, WaitlistSubmitIcon } from "./waitlist-submit-icon";

type WaitlistResponse = {
  email: string;
  status: "created" | "existing";
};

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

export const WaitlistForm = () => {
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
            inputMode="email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
          <IconButtonTooltip label="Join waitlist">
            <Button
              aria-label="Join waitlist"
              className="absolute top-1/2 right-1 size-7! -translate-y-1/2 bg-transparent text-white/70 shadow-none hover:bg-white/10 hover:text-white min-[2560px]:right-1.5 min-[2560px]:size-8!"
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
};
