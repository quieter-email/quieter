"use client";

import { ArrowLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { InputAddon, InputGroup } from "@quieter/ui/input-group";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { useState } from "react";

import { previewMessages, previewSnippets } from "./preview-data";
import type { PreviewMessage } from "./preview-data";
import { PreviewMessageBody } from "./preview-message";
import { Reveal } from "./reveal";

const KeyboardPreview = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PreviewMessage | null>(null);
  const matches = previewMessages.filter((message) =>
    `${message.subject} ${message.sender} ${message.body}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <>
      <div className="home-keyboard-art">
        <IconButtonTooltip label="Try mail search">
          <Button
            aria-label="Try mail search with Ctrl"
            className="w-25"
            onClick={() => {
              setOpen(true);
            }}
            variant="keycap"
          >
            Ctrl
          </Button>
        </IconButtonTooltip>
        <IconButtonTooltip label="Try mail search">
          <Button
            aria-label="Try mail search with K"
            className="w-17.5"
            onClick={() => {
              setOpen(true);
            }}
            variant="keycap"
          >
            K
          </Button>
        </IconButtonTooltip>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setSelected(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected ? selected.subject : "Search your mail"}
            </DialogTitle>
            <DialogDescription>Sample inbox</DialogDescription>
          </DialogHeader>
          <DialogBody spacing="4">
            {selected ? (
              <>
                <Button
                  className="self-start"
                  onClick={() => {
                    setSelected(null);
                  }}
                  variant="secondary"
                >
                  <Icon icon={ArrowLeft01Icon} />
                  Back to search
                </Button>
                <PreviewMessageBody message={selected} />
              </>
            ) : (
              <>
                <InputGroup>
                  <InputAddon className="ml-3">
                    <Icon icon={Search01Icon} tone="muted" />
                  </InputAddon>
                  <Input
                    aria-label="Search sample mail"
                    chrome="attached"
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && matches.length > 0) {
                        event.preventDefault();
                        setSelected(matches[0]);
                      }
                    }}
                    placeholder="Search mail"
                    value={query}
                  />
                </InputGroup>
                <div className="flex flex-col gap-1">
                  {matches.map((message) => (
                    <Button
                      fullWidth
                      key={message.id}
                      onClick={() => {
                        setSelected(message);
                      }}
                      size="auto"
                      variant="option"
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <Text as="span" size="sm">
                          {message.subject}
                        </Text>
                        <Text as="span" size="caption" tone="muted">
                          {message.sender}
                        </Text>
                      </span>
                    </Button>
                  ))}
                  {matches.length === 0 ? (
                    <Text tone="muted">No matching emails.</Text>
                  ) : null}
                </div>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton variant="default">Close</DialogCloseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const SnippetsPreview = () => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<
    (typeof previewSnippets)[number] | null
  >(null);
  const matches = previewSnippets.filter((snippet) =>
    snippet.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <Surface className="w-full" padding="dense">
      <div className="flex flex-col gap-2.5">
        {selected ? (
          <>
            <div className="flex items-center gap-2">
              <IconButtonTooltip label="Choose another snippet">
                <Button
                  aria-label="Choose another snippet"
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
                  }}
                  size="icon-xs"
                  variant="ghost"
                >
                  <Icon icon={ArrowLeft01Icon} />
                </Button>
              </IconButtonTooltip>
              <Text size="sm">Inserted snippet</Text>
            </div>
            <Text size="sm">{selected.body}</Text>
          </>
        ) : (
          <>
            <Text size="sm">Insert a snippet</Text>
            <InputGroup>
              <InputAddon className="ml-3">/</InputAddon>
              <Input
                aria-label="Search snippets"
                chrome="attached"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && matches.length > 0) {
                    event.preventDefault();
                    setSelected(matches[0]);
                  }
                }}
                placeholder="Search snippets"
                value={query}
              />
            </InputGroup>
            <div className="flex flex-col gap-0.5">
              {matches.map((snippet) => (
                <Button
                  fullWidth
                  key={snippet.title}
                  onClick={() => {
                    setSelected(snippet);
                  }}
                  size="auto"
                  variant="ghost"
                >
                  {snippet.title}
                </Button>
              ))}
              {matches.length === 0 ? (
                <Text size="caption" tone="muted">
                  No matching snippets.
                </Text>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Surface>
  );
};

const DevicesPreview = () => (
  <div aria-hidden className="home-devices">
    <div className="home-device-desktop">
      <div className="home-device-label">
        <span />
        Desktop app
      </div>
      <div className="home-device-content">
        <div className="home-device-sidebar" />
        <div className="home-device-lines">
          {["inbox", "projects", "personal"].map((line) => (
            <span key={line} />
          ))}
        </div>
      </div>
    </div>
    <div className="home-device-browser">
      <div className="home-device-label">
        <span />
        Web app
      </div>
      {["inbox", "projects", "personal"].map((line) => (
        <span key={line} />
      ))}
    </div>
  </div>
);

export const WorkflowPreview = () => (
  <div className="home-workflow-grid">
    {[
      {
        description: (
          <>
            Search, compose, and move through your inbox with intuitive
            shortcuts.
          </>
        ),
        preview: <KeyboardPreview />,
        title: "Keyboard shortcuts",
      },
      {
        description: (
          <>
            Save text you use often.
            <br />
            Insert it with a slash.
          </>
        ),
        preview: <SnippetsPreview />,
        title: "Reusable snippets",
      },
      {
        description: (
          <>
            Your inbox, wherever you work.
            <br />
            Open it in your browser or desktop app.
          </>
        ),
        preview: <DevicesPreview />,
        title: "Web and desktop",
      },
    ].map((feature) => (
      <Reveal className="h-full" key={feature.title}>
        <Surface className="h-full" padding="comfortable" variant="panel">
          <div className="flex h-full flex-col gap-5">
            <div className="home-workflow-art">{feature.preview}</div>
            <div className="home-workflow-caption">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          </div>
        </Surface>
      </Reveal>
    ))}
  </div>
);
