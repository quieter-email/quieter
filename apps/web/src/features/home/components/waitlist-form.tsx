import { appFetch } from "@quieter/app/runtime";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Field, FieldLabel } from "@quieter/ui/field";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { InputGroup } from "@quieter/ui/input-group";
import { toast } from "@quieter/ui/toast";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { WaitlistSubmitIcon } from "./waitlist-submit-icon";
import type { WaitlistIconState } from "./waitlist-submit-icon";

type WaitlistResponse = {
  email: string;
  status: "accepted";
};

const parseWaitlistResponse = (value: unknown): WaitlistResponse => {
  if (
    !(typeof value === "object" && value !== null) ||
    !("email" in value) ||
    !("status" in value) ||
    typeof value.email !== "string" ||
    value.status !== "accepted"
  ) {
    throw new Error("Invalid waitlist response.");
  }

  return { email: value.email, status: value.status };
};

const addToWaitlist = async (formData: FormData): Promise<WaitlistResponse> => {
  const response = await appFetch("/api/waitlist", {
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
      loading: "Adding you to the waitlist…",
      success: (response) => `Added ${response.email} to the waitlist.`,
    });

    const updateIconState = async () => {
      await request
        .then(() => {
          form.reset();
          setIconState("success");
        })
        .catch(() => {
          setIconState("error");
        })
        .finally(() => {
          window.setTimeout(() => {
            setIconState("idle");
          }, 1600);
        });
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
        <InputGroup size="lg" surface="panel">
          <Input
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            chrome="attached"
            size="lg"
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
              className="mr-0.5"
              disabled={iconState === "loading"}
              size="icon"
              type="submit"
            >
              <WaitlistSubmitIcon state={iconState} />
            </Button>
          </IconButtonTooltip>
        </InputGroup>
      </Field>
    </form>
  );
};
