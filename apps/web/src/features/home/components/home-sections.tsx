"use client";

import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m } from "motion/react";
import { useRef, useState } from "react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { WaitlistForm } from "./waitlist-form";

const featureEnter = {
  initial: { opacity: 0, transform: "translateY(16px)", filter: "blur(6px)" },
  whileInView: { opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" },
  transition: { duration: 0.65, ease: [0.23, 1, 0.32, 1] as const },
  viewport: { margin: "-64px", once: true } as const,
};

const paths = [
  {
    description:
      "Bring the mailbox you already use. Quieter adds focus while labels, drafts, reads, and actions continue to stay in sync.",
    id: "gmail",
    label: "Connect Gmail",
  },
  {
    description:
      "Create support@, press@, or billing@ on your own domain and give each teammate exactly the access their work requires.",
    id: "managed",
    label: "Run team mail",
  },
  {
    description:
      "Send product email from verified domains with organization API keys. Sent mail stays visible beside the conversations it creates.",
    id: "api",
    label: "Send via API",
  },
] as const;

type PathId = (typeof paths)[number]["id"];

const ProductPathScene = ({ id }: { id: PathId }) => {
  if (id === "gmail") {
    return (
      <div className="squircle overflow-hidden rounded-lg border border-border bg-bg/58">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-xs text-muted-fg">
          <span className="font-medium text-fg">demo@quieter.email</span>
          <span className="ml-auto inline-flex items-center gap-2 text-success">
            <span className="size-1.5 rounded-full bg-success" /> Up to date
          </span>
        </div>
        <div className="p-4 md:p-5">
          <div className="flex items-center gap-3">
            <span className="squircle grid size-8 place-items-center rounded-md bg-muted/45 text-xs text-muted-fg">
              M
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">Moonbase Finance</p>
              <p className="truncate text-xs text-muted-fg">billing@moonbase.test</p>
            </div>
            <span className="ml-auto text-xs text-muted-fg">10:47</span>
          </div>
          <p className="mt-5 text-sm font-medium text-fg">April payout reconciliation</p>
          <p className="mt-1 truncate text-xs text-muted-fg">
            Two failed transfers need review before Friday.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="squircle rounded-md bg-warning/15 px-2 py-1 text-[11px] text-warning">
              Finance
            </span>
            <span className="squircle rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-fg">
              Unread
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border text-center text-[11px] text-muted-fg">
          <span className="px-2 py-3">Drafts synced</span>
          <span className="px-2 py-3">Labels synced</span>
          <span className="px-2 py-3">Read state synced</span>
        </div>
      </div>
    );
  }

  if (id === "managed") {
    return (
      <div className="squircle overflow-hidden rounded-lg border border-border bg-bg/58">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium text-fg">support@quieter.email</p>
            <p className="mt-0.5 text-xs text-muted-fg">12 open conversations</p>
          </div>
          <div className="ml-auto flex -space-x-2">
            {["MQ", "TB", "PP"].map((initials) => (
              <span
                className="grid size-7 place-items-center rounded-full border-2 border-bg bg-muted text-[9px] text-muted-fg"
                key={initials}
              >
                {initials}
              </span>
            ))}
          </div>
        </div>
        <div className="divide-y divide-border/60">
          {[
            ["N", "Nova Reed", "Cannot invite my teammate", "Needs reply"],
            ["F", "Forgekeeper", "Question about our invoice", "Billing"],
          ].map(([initial, sender, subject, label]) => (
            <div className="flex items-center gap-3 px-4 py-3.5" key={subject}>
              <span className="squircle grid size-8 shrink-0 place-items-center rounded-md bg-muted/45 text-xs text-muted-fg">
                {initial}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-fg">{sender}</p>
                <p className="truncate text-sm text-fg">{subject}</p>
              </div>
              <span
                className={cn("ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10px]", {
                  "bg-sky-500/15 text-sky-300": label === "Billing",
                  "bg-warning/15 text-warning": label === "Needs reply",
                })}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="squircle overflow-hidden rounded-lg border border-border bg-bg/58">
      <div className="border-b border-border bg-bg-elevated/60 p-4 font-mono text-xs/6 text-muted-fg">
        <p className="text-fg">POST /api/v1/send</p>
        <p className="mt-3">from: updates@quieter.email</p>
        <p>to: nova@grid-garden.test</p>
        <p>subject: Your workspace is ready</p>
      </div>
      <div className="flex items-center gap-3 p-4">
        <span className="squircle grid size-8 place-items-center rounded-md bg-success/15 text-success">
          ✓
        </span>
        <div>
          <p className="text-sm text-fg">Delivered</p>
          <p className="text-xs text-muted-fg">Visible in the shared Sent view</p>
        </div>
        <span className="ml-auto rounded-full bg-success/15 px-2.5 py-1 text-[11px] text-success">
          Sent
        </span>
      </div>
    </div>
  );
};

const ProductPathSwitcher = () => {
  const [activeId, setActiveId] = useState<PathId>("gmail");
  const directionRef = useRef(1);
  const activePath = paths.find((path) => path.id === activeId) ?? paths[0];

  const selectPath = (id: PathId) => {
    if (id === activeId) return;
    const from = paths.findIndex((path) => path.id === activeId);
    const to = paths.findIndex((path) => path.id === id);
    directionRef.current = to > from ? 1 : -1;
    setActiveId(id);
  };

  return (
    <m.div {...featureEnter} className="mx-auto w-full max-w-5xl">
      <div
        aria-label="Ways to use Quieter"
        className="squircle mx-auto grid max-w-2xl grid-cols-3 gap-1.5 rounded-xl border border-border bg-bg-elevated/75 p-1.5 shadow-sm"
        role="tablist"
      >
        {paths.map((path) => {
          const active = path.id === activeId;

          return (
            <Button
              aria-controls="product-path-panel"
              aria-selected={active}
              className={cn(
                "h-10 min-w-0 rounded-lg px-2 text-xs text-muted-fg transition-[transform,background-color,color,box-shadow] duration-150 ease-out sm:px-4 sm:text-sm",
                {
                  "bg-bg-surface text-fg shadow-md hover:bg-bg-surface": active,
                  "hover:bg-accent/70 hover:text-fg": !active,
                },
              )}
              key={path.id}
              onClick={() => selectPath(path.id)}
              role="tab"
              variant="ghost"
            >
              <span className="truncate">{path.label}</span>
            </Button>
          );
        })}
      </div>

      <div className="squircle relative mt-4 min-h-144 overflow-hidden rounded-2xl bg-card shadow-elevation-sm md:min-h-88">
        <AnimatePresence initial={false}>
          <m.article
            animate="animate"
            className="absolute inset-0 grid content-center gap-8 p-6 md:grid-cols-[0.8fr_1.2fr] md:gap-12 md:p-8"
            exit="exit"
            id="product-path-panel"
            initial="initial"
            key={activePath.id}
            role="tabpanel"
            variants={{
              animate: {
                filter: "blur(0px)",
                opacity: 1,
                transition: { duration: 0.36, ease: [0.23, 1, 0.32, 1] },
                x: 0,
              },
              exit: () => ({
                filter: "blur(4px)",
                opacity: 0,
                transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] },
                x: `${directionRef.current * -6}%`,
              }),
              initial: () => ({
                filter: "blur(4px)",
                opacity: 0,
                x: `${directionRef.current * 6}%`,
              }),
            }}
          >
            <div className="self-center">
              <h3 className="text-3xl font-light tracking-tight text-balance text-fg md:text-4xl">
                {activePath.label}
              </h3>
              <p className="mt-5 max-w-lg text-sm/6 text-muted-fg md:text-base/7">
                {activePath.description}
              </p>
            </div>

            <ProductPathScene id={activePath.id} />
          </m.article>
        </AnimatePresence>
      </div>
    </m.div>
  );
};

const ProductImage = ({ headline, src }: { headline: string; src: string }) => (
  <m.div
    {...featureEnter}
    className="squircle relative aspect-video overflow-hidden rounded-3xl border border-border bg-card md:rounded-4xl"
  >
    <img
      alt=""
      aria-hidden
      className="absolute inset-0 size-full object-cover"
      decoding="async"
      loading="lazy"
      src={src}
    />
    <div className="absolute inset-0 bg-bg-elevated/65" />
    <div className="relative flex h-full items-center justify-center px-6">
      <h2 className="max-w-2xl text-center text-2xl font-light tracking-tight text-balance text-fg md:text-4xl">
        {headline}
      </h2>
    </div>
  </m.div>
);

const GmailFeatureShowcase = () => (
  <m.div {...featureEnter} className="squircle rounded-2xl bg-bg/35 p-3">
    <div className="grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
      <article className="squircle rounded-xl bg-card p-6 md:p-8">
        <h3 className="text-lg font-normal tracking-tight text-fg">
          Search the way you remember it.
        </h3>
        <p className="mt-2 max-w-xl text-sm/6 text-muted-fg">
          Combine people, dates, status, content, and labels without memorizing query syntax.
        </p>
        <div className="squircle mt-7 rounded-xl bg-bg-elevated/65 p-3">
          <div className="squircle flex flex-wrap gap-1.5 rounded-lg bg-bg-surface px-3 py-2.5 text-[11px] text-muted-fg">
            {["Unread", "From Moonbase", "Finance", "This month"].map((filter) => (
              <span
                className={cn("squircle rounded-md px-2 py-1", {
                  "bg-warning/15 text-warning": filter === "Finance",
                  "bg-secondary/55 text-fg/80": filter !== "Finance",
                })}
                key={filter}
              >
                {filter}
              </span>
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {[
              ["Moonbase Finance", "April payout reconciliation", "12:42"],
              ["Moonbase Finance", "Your tax invoice is ready", "Apr 18"],
            ].map(([sender, subject, time]) => (
              <div
                className="squircle grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg bg-bg/45 px-3 py-2.5 text-xs"
                key={subject}
              >
                <span className="size-1.5 rounded-full bg-fg/70" />
                <span className="min-w-0 truncate text-muted-fg">
                  <strong className="font-normal text-fg">{sender}</strong> — {subject}
                </span>
                <span className="text-muted-fg">{time}</span>
              </div>
            ))}
          </div>
        </div>
      </article>

      <article className="squircle rounded-xl bg-muted/28 p-6 md:p-8">
        <h3 className="text-lg font-normal tracking-tight text-fg">Useful details, on time.</h3>
        <p className="mt-2 text-sm/6 text-muted-fg">
          Codes, dates, and deadlines appear only when they become relevant.
        </p>
        <div className="squircle mt-7 flex items-center gap-5 rounded-xl bg-bg-elevated/65 px-5 py-6 shadow-elevation-sm">
          <div>
            <p className="text-xs text-muted-fg">Sign-in code</p>
            <p className="mt-2 font-mono text-xl tracking-[0.18em] text-fg">404 1337</p>
          </div>
          <span className="ml-auto rounded-full bg-success/15 px-2.5 py-1 text-[11px] text-success">
            8 min left
          </span>
        </div>
      </article>
    </div>

    <div className="mt-3 grid gap-3 md:grid-cols-[0.85fr_1.15fr]">
      <article className="squircle rounded-xl bg-bg-surface p-6 md:p-8">
        <span className="squircle rounded-md bg-[#5e6ad2]/18 px-2 py-1 text-xs text-[#b8bef8]">
          Product
        </span>
        <h3 className="mt-5 text-lg font-normal tracking-tight text-fg">
          Labels follow your criteria.
        </h3>
        <p className="mt-2 text-sm/6 text-muted-fg">
          Quieter applies only labels you already use, and only with direct evidence.
        </p>
      </article>

      <article className="squircle rounded-xl bg-card p-6 md:p-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="text-lg font-normal tracking-tight text-fg">Gmail stays in sync.</h3>
            <p className="mt-2 max-w-lg text-sm/6 text-muted-fg">
              Drafts, labels, read state, sent mail, spam, and trash remain mirrored.
            </p>
          </div>
          <span className="mt-1 inline-flex shrink-0 items-center gap-2 text-xs text-success">
            <span className="size-1.5 rounded-full bg-success" /> Up to date
          </span>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-1.5 text-center text-xs text-muted-fg sm:grid-cols-6">
          {["Drafts", "Labels", "Read state", "Sent", "Spam", "Trash"].map((item) => (
            <span className="squircle rounded-lg bg-secondary/35 px-2 py-3" key={item}>
              {item}
            </span>
          ))}
        </div>
      </article>
    </div>
  </m.div>
);

const ManagedFeatureShowcase = () => (
  <m.div {...featureEnter} className="squircle rounded-2xl bg-bg/35 p-3">
    <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
      <article className="squircle rounded-xl bg-card p-6 md:p-8">
        <h3 className="text-lg font-normal tracking-tight text-fg">Your domain. Real mailboxes.</h3>
        <p className="mt-2 text-sm/6 text-muted-fg">
          Receive mail directly without forwarding chains or alias workarounds.
        </p>
        <div className="squircle mt-7 space-y-1.5 rounded-xl bg-bg-elevated/65 p-2">
          {[
            ["support@quieter.email", "12 open conversations"],
            ["billing@quieter.email", "3 need a reply"],
            ["press@quieter.email", "Up to date"],
          ].map(([address, detail]) => (
            <div
              className="squircle flex items-center justify-between gap-4 rounded-lg bg-bg/50 p-3"
              key={address}
            >
              <span className="truncate text-sm text-fg">{address}</span>
              <span
                className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px]", {
                  "bg-[#5e6ad2]/18 text-[#b8bef8]": address.startsWith("support"),
                  "bg-success/15 text-success": address.startsWith("press"),
                  "bg-warning/15 text-warning": address.startsWith("billing"),
                })}
              >
                {detail}
              </span>
            </div>
          ))}
        </div>
      </article>

      <article className="squircle rounded-xl bg-muted/28 p-6 md:p-8">
        <h3 className="text-lg font-normal tracking-tight text-fg">
          Explicit access, at a glance.
        </h3>
        <p className="mt-2 text-sm/6 text-muted-fg">
          Managers, responders, and readers get only the access their work requires.
        </p>
        <div className="squircle mt-7 space-y-1.5 rounded-xl bg-bg-elevated/65 p-2">
          {[
            ["MQ", "Mara Quill", "Manager"],
            ["TB", "Theo Byte", "Responder"],
            ["PP", "Pippa Placeholder", "Reader"],
          ].map(([initials, name, role]) => (
            <div className="squircle flex items-center gap-3 rounded-lg bg-bg/50 p-3" key={name}>
              <span className="squircle grid size-7 place-items-center rounded-md bg-muted/45 text-[9px] text-muted-fg">
                {initials}
              </span>
              <span className="text-sm text-fg">{name}</span>
              <span
                className={cn("ml-auto rounded-full px-2.5 py-1 text-[11px]", {
                  "bg-[#5e6ad2]/18 text-[#b8bef8]": role === "Manager",
                  "bg-sky-500/15 text-sky-300": role === "Responder",
                  "bg-muted/55 text-muted-fg": role === "Reader",
                })}
              >
                {role}
              </span>
            </div>
          ))}
        </div>
      </article>
    </div>

    <div className="mt-3 grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
      <article className="squircle rounded-xl bg-bg-surface p-6 md:p-8">
        <h3 className="text-lg font-normal tracking-tight text-fg">One visible workflow.</h3>
        <p className="mt-2 text-sm/6 text-muted-fg">
          Shared labels and team views stay consistent. Personal saved views stay private.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {["Waiting on customer", "Needs review", "Billing", "VIP"].map((label) => (
            <span
              className={cn("rounded-full px-3 py-1.5 text-xs", {
                "bg-[#5e6ad2]/18 text-[#b8bef8]": label === "Needs review",
                "bg-muted/55 text-muted-fg": label === "VIP",
                "bg-sky-500/15 text-sky-300": label === "Billing",
                "bg-warning/15 text-warning": label === "Waiting on customer",
              })}
              key={label}
            >
              {label}
            </span>
          ))}
        </div>
      </article>

      <article className="squircle rounded-xl bg-card p-6 md:p-8">
        <h3 className="text-lg font-normal tracking-tight text-fg">
          Sending stays part of the conversation.
        </h3>
        <p className="mt-2 max-w-xl text-sm/6 text-muted-fg">
          Product mail remains visible in Sent and alongside every reply it creates.
        </p>
        <div className="mt-6 grid grid-cols-3 gap-1.5 text-center text-xs text-muted-fg">
          {["Product sends", "Sent stays visible", "Replies arrive together"].map((label) => (
            <span
              className={cn("squircle rounded-lg bg-secondary/35 p-3", {
                "bg-success/10 text-success": label === "Replies arrive together",
              })}
              key={label}
            >
              {label}
            </span>
          ))}
        </div>
      </article>
    </div>
  </m.div>
);

const AssistancePreview = () => (
  <m.div {...featureEnter} className="squircle rounded-2xl bg-bg/35 p-3">
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-fg">
      <span className="size-1.5 rounded-full bg-success" />
      Scoped to support@quieter.email
      <span className="ml-auto rounded-full bg-success/10 px-2.5 py-1 text-success">
        Nothing sends automatically
      </span>
    </div>

    <div className="mt-2 grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
      <article className="squircle rounded-xl bg-card p-6 md:p-8">
        <h3 className="text-lg font-normal tracking-tight text-fg">Cannot invite my teammate</h3>
        <div className="squircle mt-6 overflow-hidden rounded-xl bg-bg-elevated/65">
          <div className="flex items-center gap-3 bg-bg/45 px-4 py-3">
            <span className="squircle grid size-7 place-items-center rounded-md bg-muted/45 text-[9px] text-muted-fg">
              NR
            </span>
            <div>
              <p className="text-xs text-fg">Nova Reed</p>
              <p className="text-[11px] text-muted-fg">Today, 10:14</p>
            </div>
          </div>
          <p className="p-4 text-sm/6 text-fg/80">
            I invited Milo yesterday but the invitation now says expired. Can you help us get access
            before our onboarding call?
          </p>
          <div className="bg-muted/18 px-4 py-3 text-xs/5 text-muted-fg">
            Previous conversation: workspace invitation was sent to milo@ship-it.test.
          </div>
        </div>
      </article>

      <article className="squircle rounded-xl bg-bg-surface p-6 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-normal tracking-tight text-fg">
            A first draft, ready to edit.
          </h3>
          <span className="rounded-full bg-[#5e6ad2]/18 px-2.5 py-1 text-xs text-[#b8bef8]">
            Draft
          </span>
        </div>

        <div className="squircle mt-6 rounded-xl bg-bg-elevated/65 p-5 text-sm/7 text-fg/80 shadow-elevation-sm">
          <p>Hi Nova,</p>
          <p className="mt-3">
            I found the expired invitation. I’ve prepared a new invite for Milo at
            milo@ship-it.test, so you can review the address before it goes out.
          </p>
          <p className="mt-3">Once accepted, Milo will have access before your onboarding call.</p>
          <p className="mt-3">
            Best,
            <br />
            Mara
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm">Use draft</Button>
          <Button size="sm" variant="outline">
            Make it shorter
          </Button>
          <Button size="sm" variant="ghost">
            Not useful
          </Button>
          <span className="ml-auto text-xs text-muted-fg">You decide what sends</span>
        </div>
      </article>
    </div>

    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {[
        ["Mailbox-scoped", "Context never crosses into another mailbox."],
        ["Feedback-shaped", "Useful and not-useful signals improve what surfaces."],
        ["Optional", "Drafting, details, and labeling are separate settings."],
      ].map(([title, description]) => (
        <div className="squircle rounded-xl bg-card p-4 md:px-6" key={title}>
          <p className="text-[0.8rem] font-normal text-fg">{title}</p>
          <p className="mt-0.5 text-xs/5 text-muted-fg">{description}</p>
        </div>
      ))}
    </div>
  </m.div>
);

export const HomeSections = () => (
  <>
    <section className="relative overflow-hidden bg-bg px-6 pt-[min(29dvh,260px)] md:px-8 md:pt-[min(41dvh,440px)]">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center py-28 md:py-36">
        <m.div {...featureEnter} className="mb-12 max-w-2xl text-center md:mb-16">
          <h2 className="text-2xl font-light tracking-tight text-balance text-fg md:text-4xl">
            However email enters your day, it lands in one calm place.
          </h2>
        </m.div>
        <ProductPathSwitcher />
      </div>
      <WorkspaceDitherBackground className="-scale-y-100 opacity-40" />
    </section>

    <section className="relative overflow-hidden bg-bg-elevated px-6 py-20 md:px-8 md:py-28">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-12 md:gap-16">
        <ProductImage
          headline="Connect Gmail. Keep everything in sync."
          src="/landing_gmail.webp"
        />
        <GmailFeatureShowcase />
      </div>
      <WorkspaceDitherBackground className="opacity-45" />
    </section>

    <section className="relative overflow-hidden bg-bg px-6 py-20 md:px-8 md:py-28">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-12 md:gap-16">
        <ProductImage headline="Use your domain with managed mail." src="/landing_managed.webp" />
        <ManagedFeatureShowcase />
      </div>
      <WorkspaceDitherBackground className="-scale-y-100 opacity-35" />
    </section>

    <section className="relative flex min-h-[90svh] items-center overflow-hidden bg-bg-elevated px-6 py-28 md:px-8 md:py-36">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-[radial-gradient(circle_at_50%_30%,rgba(94,106,210,0.12),transparent_55%)]" />
      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <m.div {...featureEnter} className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
          <h2 className="text-3xl font-light tracking-tight text-balance text-fg md:text-5xl">
            Help with the repetitive part. Control over the important part.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-sm/6 text-muted-fg md:text-base/7">
            Quieter can gather context and prepare a reply inside one mailbox. You review, edit, and
            decide what happens next.
          </p>
        </m.div>
        <AssistancePreview />
      </div>
      <WorkspaceDitherBackground className="opacity-50" />
    </section>

    <section className="relative overflow-hidden bg-bg px-6 py-28 md:px-8 md:py-36">
      <m.div {...featureEnter} className="relative z-10 mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-light tracking-tight text-balance text-fg md:text-4xl">
          Email can do more without asking more from you.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-sm/6 text-muted-fg">
          Join the waitlist for early access to Gmail, managed mail, shared workflows, and the API
          in one quieter workspace.
        </p>
        <div className="mx-auto mt-8 max-w-sm text-left">
          <WaitlistForm />
        </div>
      </m.div>
      <WorkspaceDitherBackground className="-scale-y-100 opacity-35" />
    </section>
  </>
);
