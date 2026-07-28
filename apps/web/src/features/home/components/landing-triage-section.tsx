"use client";

import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Keycap, landingEase, Reveal, SectionIntro } from "./landing-shared";

type DemoRow = {
  id: string;
  label?: { name: string; className: string };
  preview: string;
  sender: string;
  subject: string;
  time: string;
  unread: boolean;
};

const rows: DemoRow[] = [
  {
    id: "moonbase",
    label: { className: "bg-label-orange-solid/12 text-label-orange-solid", name: "Finance" },
    preview: "Two failed transfers need review before Friday.",
    sender: "Moonbase Finance",
    subject: "April payout reconciliation",
    time: "10:47",
    unread: true,
  },
  {
    id: "nova",
    preview: "The invitation I sent Milo yesterday now says expired.",
    sender: "Nova Reed",
    subject: "Cannot invite my teammate",
    time: "10:14",
    unread: true,
  },
  {
    id: "forgekeeper",
    label: { className: "bg-label-blue-solid/12 text-label-blue-solid", name: "Billing" },
    preview: "Quick question about line four on our latest invoice.",
    sender: "Forgekeeper",
    subject: "Question about our invoice",
    time: "09:52",
    unread: false,
  },
  {
    id: "gridgarden",
    preview: "Your workspace is ready. Here is everything we set up.",
    sender: "Grid Garden",
    subject: "Welcome aboard",
    time: "09:30",
    unread: false,
  },
  {
    id: "helio",
    preview: "Agenda for Thursday and notes from the last call.",
    sender: "Helio Robotics",
    subject: "Quarterly review agenda",
    time: "09:12",
    unread: false,
  },
];

type ScriptStep =
  | { archiveId: string; key: "E" }
  | { focusIndex: number; key: "J" }
  | { key: null };

const script: ScriptStep[] = [
  { focusIndex: 0, key: "J" },
  { focusIndex: 1, key: "J" },
  { archiveId: "nova", key: "E" },
  { focusIndex: 2, key: "J" },
  { archiveId: "gridgarden", key: "E" },
  { key: null },
];

const shortcuts = [
  { key: "J", label: "Next" },
  { key: "K", label: "Previous" },
  { key: "E", label: "Archive" },
  { key: "R", label: "Reply" },
  { key: "L", label: "Label" },
  { key: "/", label: "Search" },
] as const;

const TriageVisual = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { amount: 0.45 });
  const reducedMotion = useReducedMotion();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(new Set());
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const archivedRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!inView || reducedMotion) return;

    let step = 0;
    let flashTimeout: number | undefined;

    const interval = window.setInterval(() => {
      const current = script[step % script.length];
      step += 1;

      setPressedKey(current.key);
      if (current.key !== null) {
        flashTimeout = window.setTimeout(() => setPressedKey(null), 320);
      }

      if (current.key === "J") {
        const visible = rows.filter((row) => !archivedRef.current.has(row.id));
        const target = visible[Math.min(current.focusIndex, visible.length - 1)];
        setFocusId(target?.id ?? null);
      } else if (current.key === "E") {
        setArchivedIds((previous) => {
          const next = new Set(previous);
          next.add(current.archiveId);
          archivedRef.current = next;
          return next;
        });
        setFocusId(null);
      } else {
        archivedRef.current = new Set();
        setArchivedIds(new Set());
        setFocusId(null);
      }
    }, 1400);

    return () => {
      window.clearInterval(interval);
      if (flashTimeout !== undefined) window.clearTimeout(flashTimeout);
    };
  }, [inView, reducedMotion]);

  const activeFocusId = reducedMotion ? rows[1].id : focusId;

  return (
    <div ref={containerRef}>
      <div className="overflow-hidden rounded-xl border border-white/8 bg-[oklch(0.168_0.002_264)] shadow-[0_32px_80px_-24px_oklch(0_0_0/0.6)] squircle">
        <div className="flex items-center gap-2.5 border-b border-white/6 px-5 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/90">Inbox</span>
          <span className="text-muted-foreground/50">demo@quieter.email</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground/70">
            <span aria-hidden className="size-1 rounded-full bg-success" />
            Up to date
          </span>
        </div>

        <div className="min-h-80">
          <AnimatePresence initial={false}>
            {rows
              .filter((row) => !archivedIds.has(row.id))
              .map((row) => {
                const focused = row.id === activeFocusId;

                return (
                  <m.div
                    animate={{ height: "auto", opacity: 1, x: 0 }}
                    className="overflow-hidden"
                    exit={{ height: 0, opacity: 0, x: 48 }}
                    initial={{ height: 0, opacity: 0 }}
                    key={row.id}
                    transition={{ duration: 0.36, ease: landingEase }}
                  >
                    <div
                      className={cn(
                        "relative flex items-center gap-4 border-b border-white/5 px-5 py-3.5 transition-colors duration-200",
                        { "bg-white/4": focused },
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground/60 transition-opacity duration-200",
                          focused ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span
                        aria-hidden
                        className={cn("size-1.5 shrink-0 rounded-full", {
                          "bg-label-blue-solid": row.unread,
                          "bg-transparent": !row.unread,
                        })}
                      />
                      <span
                        className={cn("w-36 shrink-0 truncate text-[13px]", {
                          "font-medium text-foreground": row.unread,
                          "text-foreground/75": !row.unread,
                        })}
                      >
                        {row.sender}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        <span className={cn({ "text-foreground/90": row.unread })}>
                          {row.subject}
                        </span>
                        <span className="text-muted-foreground/50"> — {row.preview}</span>
                      </span>
                      {row.label ? (
                        <span
                          className={cn(
                            "hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] squircle sm:inline",
                            row.label.className,
                          )}
                        >
                          {row.label.name}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-xs text-muted-foreground/60 tabular-nums">
                        {row.time}
                      </span>
                    </div>
                  </m.div>
                );
              })}
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-white/6 px-5 py-3">
          {shortcuts.map((shortcut) => (
            <span className="inline-flex items-center gap-2" key={shortcut.key}>
              <Keycap pressed={pressedKey === shortcut.key}>{shortcut.key}</Keycap>
              <span className="text-xs text-muted-foreground/70">{shortcut.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export const LandingTriageSection = () => (
  <section className="scroll-mt-14 px-5 py-28 md:px-8 md:py-40" id="workflow">
    <div className="mx-auto w-full max-w-6xl">
      <SectionIntro
        copy="Navigate, archive, label, and reply without leaving the keyboard. Every action has a shortcut, and the list keeps up with you."
        index="1.0"
        label="Workflow"
        title={
          <>
            Triage at the
            <br />
            speed of thought
          </>
        }
      />
      <Reveal className="mt-14 md:mt-20" delay={0.1}>
        <TriageVisual />
      </Reveal>
    </div>
  </section>
);
