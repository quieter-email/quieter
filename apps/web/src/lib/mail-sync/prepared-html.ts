import * as Sentry from "@sentry/tanstackstart-react";

import { preprocessEmailHtml } from "#/features/message-thread/domain/mail-html";

const prepared = new Map<
  string,
  { mailboxId: string; html: string; bytes: number }
>();
const pending = new Map<string, { mailboxId: string; html: string }>();
let used = 0;
let scheduled = false;

export const getPreparedMailHtml = (mailboxId: string, html: string) => {
  const key = `${mailboxId}\u0000${html}`;
  const cached = prepared.get(key);
  if (cached !== undefined) {
    prepared.delete(key);
    prepared.set(key, cached);
    return cached.html;
  }
  const result = preprocessEmailHtml(html);
  const bytes = (html.length + result.length) * 2;
  if (bytes <= 2 * 1024 * 1024) {
    prepared.set(key, { bytes, html: result, mailboxId });
    used += bytes;
    for (const [oldKey, entry] of prepared) {
      if (used <= 16 * 1024 * 1024) {
        break;
      }
      prepared.delete(oldKey);
      used -= entry.bytes;
    }
  }
  return result;
};

export const clearPreparedMailHtml = (mailboxId?: string) => {
  for (const [key, entry] of prepared) {
    if (mailboxId === undefined || entry.mailboxId === mailboxId) {
      prepared.delete(key);
      used -= entry.bytes;
    }
  }
  for (const [key, entry] of pending) {
    if (mailboxId === undefined || entry.mailboxId === mailboxId) {
      pending.delete(key);
    }
  }
};

const schedulePreparation = () => {
  if (scheduled || pending.size === 0 || typeof window === "undefined") {
    return;
  }
  scheduled = true;
  const prepare = () => {
    scheduled = false;
    const next = pending.entries().next().value;
    if (next !== undefined) {
      pending.delete(next[0]);
      try {
        getPreparedMailHtml(next[1].mailboxId, next[1].html);
      } catch (error) {
        Sentry.captureException(error, {
          tags: { boundary: "mail_html_preparation" },
        });
      }
    }
    schedulePreparation();
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(prepare, { timeout: 2000 });
  } else {
    setTimeout(prepare, 50);
  }
};

export const warmPreparedMailHtml = (mailboxId: string, html: string) => {
  const trimmed = html.trim();
  const key = `${mailboxId}\u0000${trimmed}`;
  if (trimmed.length > 512 * 1024 || pending.size >= 50 || prepared.has(key)) {
    return;
  }
  pending.set(key, { html: trimmed, mailboxId });
  schedulePreparation();
};
