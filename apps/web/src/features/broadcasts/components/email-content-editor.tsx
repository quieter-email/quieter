import {
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  Download01Icon,
  Image01Icon,
  TextBoldIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createEmailDesign,
  emailContentSchema,
  emailDesignSchema,
  exportEmailDesign,
  importEmailTheme,
  renderEmailContent,
} from "@quieter/mail/email-design";
import type {
  EmailBlock,
  EmailContent,
  EmailDesign,
  EmailTheme,
} from "@quieter/mail/email-design";
import { Button } from "@quieter/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import {
  EmailCanvas,
  EmailCanvasBlock,
  EmailEditorLayout,
  EmailPreview,
} from "@quieter/ui/email-editor";
import { Field, FieldLabel } from "@quieter/ui/field";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Textarea } from "@quieter/ui/textarea";
import { Toolbar, ToolbarButton, ToolbarGroup } from "@quieter/ui/toolbar";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { useRef } from "react";
import { z } from "zod";

type EditorState = {
  device: "desktop" | "mobile";
  future: EmailContent[];
  importError: string | null;
  importKind: "design" | "theme" | "html";
  inspector: "block" | "theme";
  past: EmailContent[];
  preview: boolean;
  selectedId: string | null;
};

const blockNames = {
  button: "Button",
  divider: "Divider",
  heading: "Heading",
  image: "Image",
  spacer: "Spacer",
  text: "Text",
};
const textLimits = { button: 200, heading: 1000, text: 20_000 };
const fontFamilies = {
  mono: "'Courier New', monospace",
  sans: "Arial, Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};

const newBlock = (type: EmailBlock["type"]): EmailBlock => {
  const id = crypto.randomUUID();
  switch (type) {
    case "heading": {
      return { align: "left", id, level: 2, text: "Your heading", type };
    }
    case "text": {
      return {
        align: "left",
        id,
        text: "Write something worth opening.",
        type,
      };
    }
    case "image": {
      return {
        alt: "",
        id,
        src: "https://placehold.co/640x320/png",
        type,
        width: 100,
      };
    }
    case "button": {
      return {
        align: "left",
        href: "https://example.com",
        id,
        text: "Read more",
        type,
      };
    }
    case "spacer": {
      return { height: 24, id, type };
    }
    case "divider": {
      return { id, type };
    }
    default: {
      throw new Error("Unsupported email block.");
    }
  }
};

/* oxlint-disable shadcn/no-inline-styles -- This canvas mirrors the email document's export styles. */
const BlockContent = ({
  block,
  theme,
}: {
  block: EmailBlock;
  theme: EmailTheme;
}) => {
  switch (block.type) {
    case "heading": {
      return (
        <p
          style={{
            fontSize: { 1: 32, 2: 24, 3: 20 }[block.level],
            fontWeight: 600,
            lineHeight: 1.25,
            margin: 0,
            textAlign: block.align,
            whiteSpace: "pre-wrap",
          }}
        >
          {block.text || "Heading"}
        </p>
      );
    }
    case "text": {
      return (
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.7,
            margin: 0,
            textAlign: block.align,
            whiteSpace: "pre-wrap",
          }}
        >
          {block.text || "Text"}
        </p>
      );
    }
    case "button": {
      return (
        <div style={{ textAlign: block.align }}>
          <span
            style={{
              backgroundColor: theme.primaryColor,
              borderRadius: theme.borderRadius,
              color: theme.primaryTextColor,
              display: "inline-block",
              fontSize: 15,
              fontWeight: 600,
              padding: "12px 22px",
            }}
          >
            {block.text || "Button"}
          </span>
        </div>
      );
    }
    case "image": {
      return /^https:\/\//iu.test(block.src) ? (
        <img
          alt={block.alt}
          className="mx-auto h-auto max-w-full"
          src={block.src}
          style={{ width: `${block.width}%` }}
        />
      ) : (
        <div className="grid h-36 place-items-center border border-dashed border-border text-body text-muted-fg">
          Image
        </div>
      );
    }
    case "divider": {
      return (
        <div
          style={{
            borderTop: `1px solid ${theme.mutedColor}`,
            margin: "12px 0",
          }}
        />
      );
    }
    case "spacer": {
      return <div className="min-h-2" style={{ height: block.height }} />;
    }
    default: {
      return null;
    }
  }
};

/* oxlint-enable shadcn/no-inline-styles */

const AlignmentField = ({
  onChange,
  value,
}: {
  onChange: (value: "left" | "center" | "right") => void;
  value: "left" | "center" | "right";
}) => (
  <Field>
    <FieldLabel>Alignment</FieldLabel>
    <Select
      items={[
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ]}
      onValueChange={(next) => {
        if (next === "left" || next === "center" || next === "right") {
          onChange(next);
        }
      }}
      value={value}
    >
      <SelectTrigger aria-label="Block alignment">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectList>
          <SelectItem value="left">Left</SelectItem>
          <SelectItem value="center">Center</SelectItem>
          <SelectItem value="right">Right</SelectItem>
        </SelectList>
      </SelectContent>
    </Select>
  </Field>
);

const BlockProperties = ({
  block,
  onChange,
}: {
  block: EmailBlock;
  onChange: (block: EmailBlock) => void;
}) => (
  <div className="flex flex-col gap-4">
    <h3 className="text-body font-medium">{blockNames[block.type]}</h3>
    {"text" in block ? (
      <Field>
        <FieldLabel htmlFor="email-block-text">Text</FieldLabel>
        <Textarea
          id="email-block-text"
          maxLength={textLimits[block.type]}
          onChange={(event) => {
            onChange({ ...block, text: event.target.value });
          }}
          value={block.text}
        />
      </Field>
    ) : null}
    {block.type === "heading" ? (
      <Field>
        <FieldLabel>Size</FieldLabel>
        <Select
          items={[
            { label: "Large", value: "1" },
            { label: "Medium", value: "2" },
            { label: "Small", value: "3" },
          ]}
          onValueChange={(next) => {
            if (next === "1" || next === "2" || next === "3") {
              const levels = { "1": 1, "2": 2, "3": 3 } as const;
              onChange({ ...block, level: levels[next] });
            }
          }}
          value={String(block.level)}
        >
          <SelectTrigger aria-label="Heading size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectList>
              <SelectItem value="1">Large</SelectItem>
              <SelectItem value="2">Medium</SelectItem>
              <SelectItem value="3">Small</SelectItem>
            </SelectList>
          </SelectContent>
        </Select>
      </Field>
    ) : null}
    {"align" in block ? (
      <AlignmentField
        onChange={(align) => {
          onChange({ ...block, align });
        }}
        value={block.align}
      />
    ) : null}
    {block.type === "button" || block.type === "image" ? (
      <Field>
        <FieldLabel htmlFor="email-block-link">Link</FieldLabel>
        <Input
          id="email-block-link"
          maxLength={2048}
          onChange={(event) => {
            onChange(
              block.type === "button"
                ? { ...block, href: event.target.value }
                : { ...block, href: event.target.value || undefined }
            );
          }}
          placeholder="https://"
          type="url"
          value={block.href ?? ""}
        />
      </Field>
    ) : null}
    {block.type === "image" ? (
      <>
        <Field>
          <FieldLabel htmlFor="email-image-url">Image URL</FieldLabel>
          <Input
            id="email-image-url"
            maxLength={2048}
            onChange={(event) => {
              onChange({ ...block, src: event.target.value });
            }}
            placeholder="https://"
            type="url"
            value={block.src}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="email-image-alt">Alt text</FieldLabel>
          <Input
            id="email-image-alt"
            maxLength={1000}
            onChange={(event) => {
              onChange({ ...block, alt: event.target.value });
            }}
            value={block.alt}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="email-image-width">Width, %</FieldLabel>
          <Input
            id="email-image-width"
            max={100}
            min={1}
            onChange={(event) => {
              onChange({
                ...block,
                width: Math.max(1, Math.min(100, Number(event.target.value))),
              });
            }}
            type="number"
            value={block.width}
          />
        </Field>
      </>
    ) : null}
    {block.type === "spacer" ? (
      <Field>
        <FieldLabel htmlFor="email-spacer-height">Height, px</FieldLabel>
        <Input
          id="email-spacer-height"
          max={160}
          min={0}
          onChange={(event) => {
            onChange({
              ...block,
              height: Math.max(0, Math.min(160, Number(event.target.value))),
            });
          }}
          type="number"
          value={block.height}
        />
      </Field>
    ) : null}
  </div>
);

const themeColors: {
  key:
    | "backgroundColor"
    | "canvasColor"
    | "textColor"
    | "mutedColor"
    | "primaryColor"
    | "primaryTextColor";
  label: string;
}[] = [
  { key: "backgroundColor", label: "Background" },
  { key: "canvasColor", label: "Canvas" },
  { key: "textColor", label: "Text" },
  { key: "mutedColor", label: "Dividers" },
  { key: "primaryColor", label: "Button" },
  { key: "primaryTextColor", label: "Button text" },
];

const ThemeProperties = ({
  design,
  onChange,
}: {
  design: EmailDesign;
  onChange: (design: EmailDesign) => void;
}) => (
  <div className="flex flex-col gap-4">
    <Field>
      <FieldLabel htmlFor="email-preheader">Preview text</FieldLabel>
      <Input
        id="email-preheader"
        maxLength={300}
        onChange={(event) => {
          onChange({ ...design, preheader: event.target.value });
        }}
        value={design.preheader}
      />
    </Field>
    <Field>
      <FieldLabel>Font</FieldLabel>
      <Select
        items={[
          { label: "Sans serif", value: "sans" },
          { label: "Serif", value: "serif" },
          { label: "Monospace", value: "mono" },
        ]}
        onValueChange={(next) => {
          if (next === "sans" || next === "serif" || next === "mono") {
            onChange({
              ...design,
              theme: { ...design.theme, fontFamily: next },
            });
          }
        }}
        value={design.theme.fontFamily}
      >
        <SelectTrigger aria-label="Email font">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectList>
            <SelectItem value="sans">Sans serif</SelectItem>
            <SelectItem value="serif">Serif</SelectItem>
            <SelectItem value="mono">Monospace</SelectItem>
          </SelectList>
        </SelectContent>
      </Select>
    </Field>
    <div className="grid grid-cols-2 gap-3">
      {themeColors.map(({ key, label }) => (
        <Field key={key}>
          <FieldLabel htmlFor={`email-theme-${key}`}>{label}</FieldLabel>
          <Input
            id={`email-theme-${key}`}
            aria-label={`${label} color`}
            onChange={(event) => {
              onChange({
                ...design,
                theme: { ...design.theme, [key]: event.target.value },
              });
            }}
            type="color"
            value={design.theme[key]}
          />
        </Field>
      ))}
    </div>
    {(
      [
        { key: "width", label: "Width", max: 800, min: 480 },
        { key: "padding", label: "Padding", max: 64, min: 0 },
        { key: "borderRadius", label: "Corners", max: 32, min: 0 },
      ] as const
    ).map(({ key, label, min, max }) => (
      <Field key={key}>
        <FieldLabel htmlFor={`email-theme-${key}`}>{label}, px</FieldLabel>
        <Input
          id={`email-theme-${key}`}
          max={max}
          min={min}
          onChange={(event) => {
            onChange({
              ...design,
              theme: {
                ...design.theme,
                [key]: Math.max(min, Math.min(max, Number(event.target.value))),
              },
            });
          }}
          type="number"
          value={design.theme[key]}
        />
      </Field>
    ))}
  </div>
);

/* oxlint-disable eslint/no-nested-ternary, unicorn/no-nested-ternary, shadcn/no-inline-styles -- These branches are exclusive editor formats. Canvas styles mirror the email document's export tokens. */
export const EmailContentEditor = ({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (content: EmailContent) => void;
  value: EmailContent;
}) => {
  const store = useCreateStore<EditorState>({
    device: "desktop",
    future: [],
    importError: null,
    importKind: "design",
    inspector: "block",
    past: [],
    preview: false,
    selectedId: null,
  });
  const state = useSelector(store, (snapshot) => snapshot);
  const fileInput = useRef<HTMLInputElement>(null);
  const parsed = emailContentSchema.safeParse(value);
  const rendered = parsed.success ? renderEmailContent(parsed.data) : null;
  const design = value.kind === "visual" ? value.design : null;
  const selected = design?.blocks.find(
    (block) => block.id === state.selectedId
  );
  const change = (next: EmailContent) => {
    store.setState((current) => ({
      ...current,
      future: [],
      importError: null,
      past: [...current.past.slice(-49), value],
    }));
    onChange(next);
  };
  const changeDesign = (next: EmailDesign) => {
    change({ design: next, kind: "visual" });
  };
  const importFile = async (file: File) => {
    try {
      if (file.size > 500_000) {
        throw new Error("Choose a file smaller than 500 KB.");
      }
      const source = await file.text();
      if (state.importKind === "html") {
        const imported = emailContentSchema.parse({
          html: source,
          kind: "html",
          text: "",
        });
        change({
          html: source,
          kind: "html",
          text: renderEmailContent(imported).text,
        });
      } else {
        const input: unknown = JSON.parse(source);
        if (state.importKind === "theme") {
          if (design) {
            changeDesign({ ...design, theme: importEmailTheme(input) });
          }
        } else {
          changeDesign(emailDesignSchema.parse(input));
        }
      }
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? error.issues
              .map(
                (issue) => `${issue.path.join(".") || "File"}: ${issue.message}`
              )
              .slice(0, 3)
              .join(" ")
          : error instanceof Error
            ? error.message
            : "Could not import this file.";
      store.setState((current) => ({ ...current, importError: message }));
    }
  };
  const download = (format: "html" | "react" | "json") => {
    if (!parsed.success || !rendered) {
      return;
    }
    const exported =
      value.kind === "visual" ? exportEmailDesign(value.design) : null;
    const source =
      format === "json"
        ? JSON.stringify(exported?.document ?? value, null, 2)
        : format === "react"
          ? exported?.react
          : rendered.html;
    if (!source) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([source], {
        type:
          format === "html"
            ? "text/html"
            : format === "json"
              ? "application/json"
              : "text/plain",
      })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `email.${format === "react" ? "tsx" : format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3">
      <input
        accept={
          state.importKind === "html"
            ? ".html,.htm,text/html"
            : ".json,application/json"
        }
        aria-label="Import email file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void importFile(file);
          }
          event.target.value = "";
        }}
        ref={fileInput}
        type="file"
      />
      <EmailEditorLayout
        canvas={
          state.preview ? (
            <EmailPreview
              device={state.device}
              html={rendered?.html ?? null}
              text={
                rendered?.text ??
                "Fix the highlighted content to preview this email."
              }
            />
          ) : design ? (
            <div
              style={{
                backgroundColor: design.theme.backgroundColor,
                padding: 16,
              }}
            >
              <EmailCanvas
                device={state.device}
                style={{
                  backgroundColor: design.theme.canvasColor,
                  borderRadius: design.theme.borderRadius,
                  color: design.theme.textColor,
                  fontFamily: fontFamilies[design.theme.fontFamily],
                  padding:
                    state.device === "mobile"
                      ? Math.min(24, design.theme.padding)
                      : design.theme.padding,
                }}
                width={design.theme.width}
              >
                <div className="flex flex-col gap-5 py-6">
                  {design.blocks.map((block, index) => (
                    <EmailCanvasBlock
                      disabled={disabled}
                      first={index === 0}
                      key={block.id}
                      label={blockNames[block.type].toLowerCase()}
                      last={index === design.blocks.length - 1}
                      onDelete={() => {
                        changeDesign({
                          ...design,
                          blocks: design.blocks.filter(
                            (item) => item.id !== block.id
                          ),
                        });
                        store.setState((current) => ({
                          ...current,
                          selectedId: null,
                        }));
                      }}
                      onDuplicate={() => {
                        const clone = { ...block, id: crypto.randomUUID() };
                        changeDesign({
                          ...design,
                          blocks: [
                            ...design.blocks.slice(0, index + 1),
                            clone,
                            ...design.blocks.slice(index + 1),
                          ],
                        });
                        store.setState((current) => ({
                          ...current,
                          selectedId: clone.id,
                        }));
                      }}
                      onMove={(direction) => {
                        const blocks = [...design.blocks];
                        const target = index + direction;
                        const adjacent = blocks[target];
                        if (target >= 0 && target < blocks.length) {
                          blocks[index] = adjacent;
                          blocks[target] = block;
                          changeDesign({ ...design, blocks });
                        }
                      }}
                      onSelect={() => {
                        store.setState((current) => ({
                          ...current,
                          inspector: "block",
                          selectedId: block.id,
                        }));
                      }}
                      selected={selected?.id === block.id}
                    >
                      <BlockContent block={block} theme={design.theme} />
                    </EmailCanvasBlock>
                  ))}
                  {design.blocks.length === 0 ? (
                    <p className="py-16 text-center text-body text-muted-fg">
                      Add a block to begin.
                    </p>
                  ) : null}
                </div>
              </EmailCanvas>
            </div>
          ) : (
            <div className="mx-auto flex max-w-180 flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="email-source">
                  {value.kind === "html" ? "HTML source" : "Message"}
                </FieldLabel>
                <Textarea
                  id="email-source"
                  aria-invalid={!parsed.success}
                  className="min-h-120"
                  disabled={disabled}
                  maxLength={value.kind === "html" ? 250_000 : 100_000}
                  onChange={(event) => {
                    change(
                      value.kind === "html"
                        ? { ...value, html: event.target.value }
                        : { kind: "text", text: event.target.value }
                    );
                  }}
                  placeholder={
                    value.kind === "html"
                      ? "Paste rendered HTML"
                      : "Write your email"
                  }
                  spellCheck={value.kind !== "html"}
                  value={
                    value.kind === "html"
                      ? value.html
                      : value.kind === "text"
                        ? value.text
                        : ""
                  }
                />
              </Field>
              {value.kind === "html" ? (
                <Field>
                  <FieldLabel htmlFor="email-plain-alternative">
                    Plain text alternative
                  </FieldLabel>
                  <Textarea
                    id="email-plain-alternative"
                    disabled={disabled}
                    maxLength={100_000}
                    onChange={(event) => {
                      change({ ...value, text: event.target.value });
                    }}
                    value={value.text}
                  />
                </Field>
              ) : null}
            </div>
          )
        }
        inspector={
          design && !state.preview ? (
            <fieldset className="flex flex-col gap-4" disabled={disabled}>
              <Toolbar aria-label="Properties" size="compact">
                <ToolbarButton
                  aria-pressed={state.inspector === "block"}
                  onClick={() => {
                    store.setState((current) => ({
                      ...current,
                      inspector: "block",
                    }));
                  }}
                  variant={state.inspector === "block" ? "selected" : "default"}
                >
                  Block
                </ToolbarButton>
                <ToolbarButton
                  aria-pressed={state.inspector === "theme"}
                  onClick={() => {
                    store.setState((current) => ({
                      ...current,
                      inspector: "theme",
                    }));
                  }}
                  variant={state.inspector === "theme" ? "selected" : "default"}
                >
                  Style
                </ToolbarButton>
              </Toolbar>
              {state.inspector === "theme" ? (
                <ThemeProperties design={design} onChange={changeDesign} />
              ) : selected ? (
                <BlockProperties
                  block={selected}
                  onChange={(next) => {
                    changeDesign({
                      ...design,
                      blocks: design.blocks.map((block) =>
                        block.id === next.id ? next : block
                      ),
                    });
                  }}
                />
              ) : (
                <p className="text-caption text-muted-fg">
                  Select a block to edit.
                </p>
              )}
            </fieldset>
          ) : undefined
        }
        palette={
          design && !state.preview ? (
            <div className="flex flex-row flex-wrap gap-2 xl:flex-col">
              <h2 className="w-full pb-1 text-caption font-medium text-muted-fg">
                Add block
              </h2>
              {(
                [
                  "heading",
                  "text",
                  "image",
                  "button",
                  "divider",
                  "spacer",
                ] as const
              ).map((type) => (
                <Button
                  disabled={disabled || design.blocks.length >= 100}
                  key={type}
                  onClick={() => {
                    const block = newBlock(type);
                    const selectedIndex = design.blocks.findIndex(
                      (item) => item.id === state.selectedId
                    );
                    const index =
                      selectedIndex === -1
                        ? design.blocks.length
                        : selectedIndex + 1;
                    changeDesign({
                      ...design,
                      blocks: [
                        ...design.blocks.slice(0, index),
                        block,
                        ...design.blocks.slice(index),
                      ],
                    });
                    store.setState((current) => ({
                      ...current,
                      inspector: "block",
                      selectedId: block.id,
                    }));
                  }}
                  size="sm"
                  variant="outline"
                >
                  {type === "image" ? (
                    <HugeiconsIcon aria-hidden icon={Image01Icon} />
                  ) : type === "heading" ? (
                    <HugeiconsIcon aria-hidden icon={TextBoldIcon} />
                  ) : null}
                  {blockNames[type]}
                </Button>
              ))}
            </div>
          ) : undefined
        }
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Toolbar aria-label="Content format" size="compact">
                <ToolbarGroup>
                  {(
                    [
                      { kind: "visual", label: "Design" },
                      { kind: "text", label: "Text" },
                      { kind: "html", label: "HTML" },
                    ] as const
                  ).map(({ kind, label }) => (
                    <ToolbarButton
                      aria-pressed={value.kind === kind}
                      disabled={disabled}
                      key={kind}
                      onClick={() => {
                        if (kind !== value.kind) {
                          change(
                            kind === "visual"
                              ? { design: createEmailDesign(), kind }
                              : kind === "text"
                                ? { kind, text: rendered?.text ?? "" }
                                : {
                                    html: rendered?.html ?? "",
                                    kind,
                                    text: rendered?.text ?? "",
                                  }
                          );
                          store.setState((current) => ({
                            ...current,
                            preview: false,
                            selectedId: null,
                          }));
                        }
                      }}
                      variant={value.kind === kind ? "selected" : "default"}
                    >
                      {label}
                    </ToolbarButton>
                  ))}
                </ToolbarGroup>
              </Toolbar>
              <div className="flex gap-0.5">
                {[
                  {
                    icon: ArrowTurnBackwardIcon,
                    label: "Undo",
                    snapshots: state.past,
                    undo: true,
                  },
                  {
                    icon: ArrowTurnForwardIcon,
                    label: "Redo",
                    snapshots: state.future,
                    undo: false,
                  },
                ].map(({ icon, label, snapshots, undo }) => (
                  <IconButtonTooltip key={label} label={label}>
                    <Button
                      aria-label={label}
                      disabled={disabled || snapshots.length === 0}
                      onClick={() => {
                        const next = snapshots.at(-1);
                        if (next) {
                          store.setState((current) => ({
                            ...current,
                            future: undo
                              ? [...current.future, value]
                              : current.future.slice(0, -1),
                            past: undo
                              ? current.past.slice(0, -1)
                              : [...current.past, value],
                          }));
                          onChange(next);
                        }
                      }}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <HugeiconsIcon aria-hidden icon={icon} />
                    </Button>
                  </IconButtonTooltip>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Toolbar aria-label="Preview size" size="compact">
                <ToolbarButton
                  aria-pressed={state.device === "desktop"}
                  onClick={() => {
                    store.setState((current) => ({
                      ...current,
                      device: "desktop",
                    }));
                  }}
                  variant={state.device === "desktop" ? "selected" : "default"}
                >
                  Desktop
                </ToolbarButton>
                <ToolbarButton
                  aria-pressed={state.device === "mobile"}
                  onClick={() => {
                    store.setState((current) => ({
                      ...current,
                      device: "mobile",
                    }));
                  }}
                  variant={state.device === "mobile" ? "selected" : "default"}
                >
                  Mobile
                </ToolbarButton>
              </Toolbar>
              <Button
                aria-pressed={state.preview}
                onClick={() => {
                  store.setState((current) => ({
                    ...current,
                    preview: !current.preview,
                  }));
                }}
                size="sm"
                variant="ghost"
              >
                {state.preview ? "Edit" : "Preview"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={disabled}
                  render={<Button size="sm" variant="outline" />}
                >
                  Import
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      store.setState((current) => ({
                        ...current,
                        importKind: "design",
                      }));
                      if (fileInput.current) {
                        fileInput.current.accept = ".json,application/json";
                        fileInput.current.click();
                      }
                    }}
                  >
                    Design JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!design}
                    onSelect={() => {
                      store.setState((current) => ({
                        ...current,
                        importKind: "theme",
                      }));
                      if (fileInput.current) {
                        fileInput.current.accept = ".json,application/json";
                        fileInput.current.click();
                      }
                    }}
                  >
                    Theme tokens
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      store.setState((current) => ({
                        ...current,
                        importKind: "html",
                      }));
                      if (fileInput.current) {
                        fileInput.current.accept = ".html,.htm,text/html";
                        fileInput.current.click();
                      }
                    }}
                  >
                    HTML / React Email output
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button size="sm" variant="ghost" />}
                >
                  <HugeiconsIcon aria-hidden icon={Download01Icon} />
                  Export
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!parsed.success || !rendered?.html}
                    onSelect={() => {
                      download("html");
                    }}
                  >
                    HTML
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!parsed.success || !design}
                    onSelect={() => {
                      download("react");
                    }}
                  >
                    React Email
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!parsed.success || !design}
                    onSelect={() => {
                      download("json");
                    }}
                  >
                    Design JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        }
      />
      {state.importError ? (
        <p className="text-caption text-destructive" role="alert">
          {state.importError}
        </p>
      ) : null}
      {parsed.success ? null : (
        <p className="text-caption text-destructive" role="alert">
          {parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(" ")}
        </p>
      )}
      {rendered?.warnings.map((warning) => (
        <p className="text-caption text-muted-fg" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
};
