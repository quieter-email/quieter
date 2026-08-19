"use client";

import { Delete02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Textarea } from "@quieter/ui/textarea";
import { TokenField } from "@quieter/ui/token-field";
import type { TokenFieldToken } from "@quieter/ui/token-field";
import { useState } from "react";
import type { ReactNode } from "react";

import { EmptyMessageState } from "#/components/empty-message-state";
import { MobileHeader } from "#/components/mobile-header";

// Sample data only. Real mentions come from the user's connected apps.
const showcaseTokens: TokenFieldToken[] = [
  {
    description: "Sample app",
    id: "sample-tracker",
    label: "Tracker",
    text: "@Tracker",
    tone: "purple",
  },
  {
    description: "Sample app",
    id: "sample-calendar",
    label: "Calendar",
    text: "@Calendar",
    tone: "blue",
  },
];

// Literal classes: Tailwind cannot extract an interpolated `bg-${name}`.
const surfaceTokens = [
  { cls: "bg-bg", name: "bg", note: "canvas" },
  { cls: "bg-bg-surface", name: "bg-surface", note: "raised" },
  { cls: "bg-bg-elevated", name: "bg-elevated", note: "sunken" },
  { cls: "bg-card", name: "card", note: "raised, both themes" },
  { cls: "bg-muted", name: "muted", note: "alias of control-hover" },
  { cls: "bg-secondary", name: "secondary", note: "alias of control" },
  {
    cls: "bg-control",
    name: "control",
    note: "fields, quiet buttons, popovers",
  },
  {
    cls: "bg-control-hover",
    name: "control-hover",
    note: "hover, menu highlight",
  },
  { cls: "bg-control-active", name: "control-active", note: "pressed" },
];

const textTokens = [
  { cls: "text-display-lg", name: "display-lg" },
  { cls: "text-display-md", name: "display-md" },
  { cls: "text-title-lg", name: "title-lg" },
  { cls: "text-title-md", name: "title-md" },
  { cls: "text-title-sm", name: "title-sm" },
  { cls: "text-body-lg", name: "body-lg" },
  { cls: "text-body", name: "body" },
  { cls: "text-body-sm", name: "body-sm" },
  { cls: "text-caption", name: "caption" },
  { cls: "text-micro", name: "micro" },
];

const pillTones: PillTone[] = [
  "gray",
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
];

const Section = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) => (
  <section className="border-t border-border pt-8">
    <h2 className="text-title-sm tracking-tight text-fg">{title}</h2>
    {description === undefined ? null : (
      <p className="mt-1 text-body-sm text-muted-fg">{description}</p>
    )}
    <div className="mt-5">{children}</div>
  </section>
);

const Row = ({ children, label }: { children: ReactNode; label: string }) => (
  <div className="flex flex-col gap-2 py-3 @md:flex-row @md:items-center @md:gap-6">
    <p className="w-44 shrink-0 text-body-sm text-muted-fg">{label}</p>
    <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
  </div>
);

export const DesignSystemShowcase = () => {
  const [checked, setChecked] = useState(true);
  const [tokenFieldValue, setTokenFieldValue] = useState(
    "When it's a bug, use @Tracker to file it."
  );
  const [boxChecked, setBoxChecked] = useState(true);

  return (
    <main className="@container min-h-dvh bg-bg text-fg">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
        <header>
          <h1 className="text-title-lg tracking-tight text-fg">
            Quieter design system
          </h1>
          <p className="mt-2 max-w-prose text-body-sm text-muted-fg">
            Every control the product composes from. If a surface needs
            something that is not here, extend a primitive rather than inventing
            one locally. Toggle your OS or app theme to review both palettes.
          </p>
        </header>

        <Section
          description="A card reads as raised in both themes. bg-elevated sits below the canvas."
          title="Surfaces"
        >
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3">
            {surfaceTokens.map((token) => (
              <div
                className={cn(
                  "squircle rounded-md border border-border p-4",
                  token.cls
                )}
                key={token.name}
              >
                <p className="text-body-sm font-medium text-fg">{token.name}</p>
                <p className="text-micro text-muted-fg">{token.note}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Borders">
          <div className="flex flex-wrap gap-3">
            <div className="squircle rounded-md border border-border px-4 py-3 text-body-sm">
              border
            </div>
            <div className="squircle rounded-md border border-border-strong px-4 py-3 text-body-sm">
              border-strong
            </div>
          </div>
        </Section>

        <Section
          description="Every size in the product comes from this scale. No arbitrary sizes: if a design lands between two steps, take the smaller one."
          title="Typography"
        >
          <div className="space-y-2">
            {textTokens.map((token) => (
              <div className="flex items-baseline gap-4" key={token.name}>
                <span className="w-28 shrink-0 text-micro text-muted-fg">
                  {token.name}
                </span>
                <span className={cn("truncate text-fg", token.cls)}>
                  Quiet structure
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <Row label="Variants">
            <Button type="button">Primary</Button>
            <Button type="button" variant="outline">
              Outline
            </Button>
            <Button type="button" variant="ghost">
              Ghost
            </Button>
            <Button type="button" variant="destructive">
              Destructive
            </Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm" type="button">
              Small
            </Button>
            <Button type="button">Default</Button>
            <Button size="lg" type="button">
              Large
            </Button>
          </Row>
          <Row label="Icon, with tooltip">
            <IconButtonTooltip label="Delete">
              <Button aria-label="Delete" size="icon-sm" variant="ghost">
                <HugeiconsIcon aria-hidden icon={Delete02Icon} />
              </Button>
            </IconButtonTooltip>
            <IconButtonTooltip label="Mail">
              <Button aria-label="Mail" size="icon" variant="ghost">
                <HugeiconsIcon aria-hidden icon={Mail01Icon} />
              </Button>
            </IconButtonTooltip>
          </Row>
          <Row label="Disabled">
            <Button disabled type="button">
              Primary
            </Button>
            <Button disabled type="button" variant="outline">
              Outline
            </Button>
          </Row>
        </Section>

        <Section title="Form controls">
          <Row label="Input">
            <Input className="w-64" placeholder="Placeholder" />
          </Row>
          <Row label="Input, invalid">
            <Input aria-invalid className="w-64" defaultValue="Not an email" />
          </Row>
          <Row label="Textarea">
            <Textarea className="w-64" placeholder="Placeholder" />
          </Row>
          <Row label="Token field">
            <div className="squircle w-80 rounded-md border border-border bg-input px-3 py-2 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/45">
              <TokenField
                aria-label="Token field"
                className="max-h-32 min-h-16 overflow-y-auto text-body"
                onChange={setTokenFieldValue}
                placeholder="Type @ to mention an app…"
                tokens={showcaseTokens}
                value={tokenFieldValue}
              />
            </div>
          </Row>
          <Row label="Field with label">
            <Field className="w-64">
              <FieldLabel htmlFor="showcase-field">Email address</FieldLabel>
              <Input id="showcase-field" placeholder="you@example.com" />
              <FieldDescription>
                Visible labels, not placeholders.
              </FieldDescription>
            </Field>
          </Row>
          <Row label="Switch, default">
            <Switch checked={checked} onCheckedChange={setChecked}>
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Switch, sm">
            <Switch checked={checked} onCheckedChange={setChecked} size="sm">
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Switch, pending">
            <Switch checked pending size="sm">
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Switch, disabled">
            <Switch checked disabled size="sm">
              <SwitchThumb />
            </Switch>
          </Row>
          <Row label="Checkbox">
            <Checkbox checked={boxChecked} onCheckedChange={setBoxChecked}>
              <CheckboxIndicator />
            </Checkbox>
          </Row>
        </Section>

        <Section
          description="Categorical only. State uses success, warning, and destructive."
          title="Pills"
        >
          <div className="flex flex-wrap gap-2">
            {pillTones.map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
          </div>
          <Row label="Sizes">
            <Pill tone="blue">Default</Pill>
            <Pill size="xs" tone="blue">
              Compact
            </Pill>
          </Row>
        </Section>

        <Section title="Mobile header">
          <div className="squircle overflow-hidden rounded-md border border-border">
            <MobileHeader
              className="flex"
              leading="sidebar"
              onLeadingClick={() => {
                // Static preview; the product wires this to the drawer.
              }}
              title="New message"
            />
            <MobileHeader
              className="flex"
              leading="back"
              onLeadingClick={() => {
                // Static preview; the product wires this to the drawer.
              }}
            />
          </div>
          <p className="mt-2 text-micro text-muted-fg">
            Forced visible here; in the product it is `lg:hidden`.
          </p>
        </Section>

        <Section
          description="One mark, one statement, one optional next action. Holds still under reduced motion."
          title="Empty state"
        >
          <div className="squircle flex min-h-64 rounded-md border border-border">
            <EmptyMessageState
              action={
                <Button size="sm" type="button" variant="outline">
                  Start a new message
                </Button>
              }
            />
          </div>
        </Section>
      </div>
    </main>
  );
};
