import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Field, FieldLabel } from "@quieter/ui/field";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { WaitlistSubmitIcon } from "./waitlist-submit-icon";
import type { WaitlistIconState } from "./waitlist-submit-icon";

type WaitlistResponse = {
  email: string;
  status: "created" | "existing";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseWaitlistResponse = (value: unknown): WaitlistResponse => {
  if (
    !isRecord(value) ||
    typeof value.email !== "string" ||
    (value.status !== "created" && value.status !== "existing")
  ) {
    throw new Error("Invalid waitlist response.");
  }

  return { email: value.email, status: value.status };
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

  return parseWaitlistResponse(await response.json());
};

export const WaitlistForm = ({
  className,
  id,
}: {
  className?: string;
  id?: string;
}) => {
  const [iconState, setIconState] = useState<WaitlistIconState>("idle");
  const fieldId =
    id !== undefined && id !== "" ? `${id}-email` : "waitlist-email";

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    setIconState("loading");

    const request = addToWaitlist(new FormData(form));

    void toast.promise(request, {
      error: "Something went wrong. Try again.",
      loading: "Adding you to the waitlist...",
      success: (response) =>
        response.status === "existing"
          ? "You're already on the waitlist."
          : `Added ${response.email} to the waitlist.`,
    });

    const updateIconState = async () => {
      try {
        await request;
        form.reset();
        setIconState("success");
      } catch {
        setIconState("error");
      } finally {
        window.setTimeout(() => {
          setIconState("idle");
        }, 1600);
      }
    };
    void updateIconState();
  };

  return (
    <form
      action="/api/waitlist"
      className={cn("grid w-full max-w-sm gap-2", className)}
      method="post"
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel htmlFor={fieldId}>Join the waitlist</FieldLabel>
        <div className="relative">
          <Input
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            className="bg-bg-elevated pr-11"
            disabled={iconState === "loading"}
            id={fieldId}
            inputMode="email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
          <IconButtonTooltip label="Join waitlist">
            <Button
              aria-label="Join waitlist"
              className="absolute top-1/2 right-1 -translate-y-1/2"
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
