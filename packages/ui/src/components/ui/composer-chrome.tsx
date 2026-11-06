"use client";

import {
  Cancel01Icon,
  Loading03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./button";
import { Field, FieldError, FieldLabel } from "./field";
import { Icon } from "./icon";
import { IconButtonTooltip } from "./icon-button-tooltip";
import { entranceMotionVariants } from "./motion";

export const PromptComposerFrame = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => {
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);

  useEffect(() => {
    // Text inputs also match :focus-visible after a click or while typing.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setKeyboardNavigation(true);
      }
    };
    const handlePointerDown = () => {
      setKeyboardNavigation(false);
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-section border border-transparent bg-section p-2 shadow-sm data-keyboard-navigation:has-[:focus-visible]:ring-1 data-keyboard-navigation:has-[:focus-visible]:ring-ring data-keyboard-navigation:has-[:focus-visible]:ring-inset",
        className
      )}
      data-keyboard-navigation={keyboardNavigation || undefined}
      {...props}
    />
  );
};

export const ComposerActionBar = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-transparent bg-detail p-1.5 squircle",
      className
    )}
    {...props}
  />
);

export const ComposerContextChip = ({
  disabled,
  icon,
  label,
  onRemove,
}: {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onRemove: () => void;
}) => (
  <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm border border-transparent bg-detail pl-2 text-caption text-muted-fg">
    {icon}
    <span className="min-w-0 truncate" title={label}>
      {label}
    </span>
    <IconButtonTooltip label={`Remove ${label}`}>
      <Button
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={onRemove}
        size="icon-xs"
        variant="ghost"
      >
        <Icon aria-hidden icon={Cancel01Icon} />
      </Button>
    </IconButtonTooltip>
  </span>
);

/** Shared chrome for the mail composer. */
export const ComposerFrame = ({
  children,
  className,
  layout = "default",
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  layout?: "default" | "inline";
}) => (
  <div
    className={cn(
      "mx-auto my-auto flex min-h-0 w-full max-w-[58rem] flex-1 flex-col gap-2 p-4 sm:p-6 md:max-h-[28rem]",
      { "my-0 max-w-none flex-none p-0 sm:p-0": layout === "inline" },
      className
    )}
    {...props}
  >
    {children}
  </div>
);

/** The one element that holds every header input, hairline-divided rather than boxed. */
export const ComposerFieldGroup = ({
  bare = false,
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  bare?: boolean;
}) => (
  <div
    className={cn(
      "w-full shrink-0 overflow-hidden rounded-section border border-transparent bg-section",
      { "rounded-none border-0 bg-transparent shadow-none": bare },
      className
    )}
    {...props}
  >
    {children}
  </div>
);

const composerFieldRowClassName =
  "flex min-w-0 items-center gap-(--composer-field-gap) px-(--composer-field-inset) transition-colors duration-150 ease-out has-[:focus-visible]:bg-detail";

export const ComposerFieldRow = ({
  children,
  className,
  divided = true,
  error,
  label,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  divided?: boolean;
  error?: string;
  label: string;
  trailing?: ReactNode;
}) => (
  <Field
    className={cn(
      "gap-0 [--composer-field-gap:calc(var(--spacing)*2.5)] [--composer-field-inset:calc(var(--spacing)*4)] [--composer-field-label-width:calc(var(--spacing)*14)]",
      { "border-b border-transparent": divided },
      className
    )}
  >
    <div className={composerFieldRowClassName}>
      <FieldLabel className="w-(--composer-field-label-width) shrink-0 text-body font-normal text-muted-fg">
        {label}
      </FieldLabel>
      {children}
      {trailing}
    </div>
    {error === undefined ? null : (
      <FieldError className="px-(--composer-field-inset) pb-2 pl-[calc(var(--composer-field-inset)+var(--composer-field-label-width)+var(--composer-field-gap))] text-caption">
        {error}
      </FieldError>
    )}
  </Field>
);

/** Body, headers, and toolbar share one quiet writing surface. */
export const ComposerEditorFrame = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "flex min-h-0 flex-1 flex-col overflow-hidden rounded-section bg-section squircle has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type ComposerDictationState =
  | { phase: "recording"; analyser: AnalyserNode | null }
  | { phase: "starting" | "transcribing" };

const waveformBars = Array.from({ length: 18 }, (_, index) => index);
const dictationLabels = {
  recording: "Listening",
  starting: "Starting dictation",
  transcribing: "Transcribing dictation",
};

const DictationWaveform = ({ analyser }: { analyser: AnalyserNode | null }) => {
  const waveformRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = waveformRef.current;
    if (!element || !analyser) {
      return;
    }
    const bars = [...element.children].filter(
      (bar) => bar instanceof HTMLElement
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const samples = new Uint8Array(analyser.fftSize);
    const history = Array.from({ length: waveformBars.length }, () => 0.1);
    const heights = [...history];
    let lastSample = 0;
    let frame = 0;
    const draw = (time: number) => {
      if (time - lastSample >= 50) {
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128;
          energy += amplitude * amplitude;
        }
        history.shift();
        history.push(
          Math.max(0.1, Math.min(1, Math.sqrt(energy / samples.length) * 5))
        );
        lastSample = time;
      }
      for (const [index, bar] of bars.entries()) {
        const target = history[index] ?? 0.1;
        const height =
          (heights[index] ?? 0.1) + (target - (heights[index] ?? 0.1)) * 0.3;
        heights[index] = height;
        bar.style.transform = `scaleY(${height})`;
      }
      frame = requestAnimationFrame(draw);
    };
    const updateMotion = () => {
      cancelAnimationFrame(frame);
      if (reducedMotion.matches) {
        for (const bar of bars) {
          bar.style.transform = "scaleY(0.1)";
        }
      } else {
        frame = requestAnimationFrame(draw);
      }
    };
    reducedMotion.addEventListener("change", updateMotion);
    updateMotion();
    // oxlint-disable-next-line typescript/consistent-return -- Inactive audio has no animation loop or listener to dispose.
    return () => {
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener("change", updateMotion);
    };
  }, [analyser]);

  return (
    <span
      aria-hidden
      className="flex h-5 min-w-0 flex-1 items-center justify-between gap-0.5 overflow-hidden"
      ref={waveformRef}
    >
      {waveformBars.map((index) => (
        <span
          className="h-5 w-0.5 shrink-0 rounded-full bg-fg"
          key={index}
          // oxlint-disable-next-line shadcn/no-inline-styles -- Silence and live audio must write the same transform property.
          style={{ transform: "scaleY(0.1)" }}
        />
      ))}
    </span>
  );
};

export const ComposerDictationControl = ({
  disabled,
  onCancel,
  onFinish,
  state,
}: {
  disabled?: boolean;
  onCancel: () => void;
  onFinish: () => void;
  state: ComposerDictationState;
}) => (
  <div
    className={cn(
      "inline-flex h-8 w-36 shrink-0 items-center gap-2 rounded-full bg-panel p-1 not-squircle",
      entranceMotionVariants({ effect: "pop" })
    )}
  >
    <IconButtonTooltip label="Cancel dictation">
      <Button
        aria-label="Cancel dictation"
        chrome="round"
        disabled={disabled}
        onClick={onCancel}
        size="icon-xs"
        variant="secondary"
      >
        <Icon aria-hidden icon={Cancel01Icon} />
      </Button>
    </IconButtonTooltip>
    {state.phase === "recording" ? (
      <>
        <DictationWaveform analyser={state.analyser} />
        <IconButtonTooltip label="Finish dictation">
          <Button
            aria-label="Finish dictation"
            chrome="round"
            disabled={disabled}
            onClick={onFinish}
            size="icon-xs"
          >
            <Icon aria-hidden icon={Tick02Icon} />
          </Button>
        </IconButtonTooltip>
      </>
    ) : (
      <span
        aria-hidden
        className="flex min-w-0 flex-1 items-center gap-1 text-micro text-muted-fg"
      >
        <Icon animation="spin" icon={Loading03Icon} size={12} />
        <span>
          {state.phase === "starting" ? "Starting…" : "Transcribing…"}
        </span>
      </span>
    )}
    <output aria-live="polite" className="sr-only">
      {dictationLabels[state.phase]}
    </output>
  </div>
);
