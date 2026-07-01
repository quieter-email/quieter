import { createElement as h, type CSSProperties } from "react";

type AuthActionEmailProps = {
  body: string;
  cta: string;
  preview: string;
  title: string;
  url: string;
};

const colors = {
  background: "#f6f4ef",
  border: "#ded8ce",
  button: "#22211f",
  buttonText: "#ffffff",
  muted: "#6f6a62",
  panel: "#ffffff",
  text: "#24211d",
};

const fontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const styles = {
  body: {
    background: colors.background,
    color: colors.text,
    fontFamily,
    margin: 0,
    padding: "32px 16px",
  },
  brand: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 0,
    padding: "0 0 18px",
  },
  button: {
    background: colors.button,
    borderRadius: 8,
    color: colors.buttonText,
    display: "inline-block",
    fontSize: 15,
    fontWeight: 700,
    lineHeight: "20px",
    padding: "12px 18px",
    textDecoration: "none",
  },
  footer: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: "18px",
    padding: "18px 0 0",
  },
  heading: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: "32px",
    margin: "0 0 14px",
  },
  linkHelp: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: "20px",
    margin: "28px 0 0",
  },
  linkText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: "20px",
    margin: "8px 0 0",
    wordBreak: "break-all",
  },
  panel: {
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: "34px 32px",
  },
  preview: {
    display: "none",
    maxHeight: 0,
    opacity: 0,
    overflow: "hidden",
  },
  table: {
    margin: "0 auto",
    maxWidth: 560,
    width: "100%",
  },
  text: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: "24px",
    margin: "0 0 26px",
  },
} satisfies Record<string, CSSProperties>;

const createAuthActionEmail = (props: AuthActionEmailProps) =>
  h(
    "html",
    { lang: "en" },
    h(
      "head",
      null,
      h("title", null, props.title),
      h("meta", { content: "text/html; charset=UTF-8", httpEquiv: "Content-Type" }),
      h("meta", { content: "width=device-width, initial-scale=1.0", name: "viewport" }),
    ),
    h(
      "body",
      {
        style: styles.body,
      },
      h(
        "div",
        {
          style: styles.preview,
        },
        props.preview,
      ),
      h(
        "table",
        {
          cellPadding: "0",
          cellSpacing: "0",
          role: "presentation",
          style: styles.table,
        },
        h(
          "tbody",
          null,
          h(
            "tr",
            null,
            h(
              "td",
              {
                style: styles.brand,
              },
              "Quieter",
            ),
          ),
          h(
            "tr",
            null,
            h(
              "td",
              {
                style: styles.panel,
              },
              h(
                "h1",
                {
                  style: styles.heading,
                },
                props.title,
              ),
              h(
                "p",
                {
                  style: styles.text,
                },
                props.body,
              ),
              h(
                "a",
                {
                  href: props.url,
                  style: styles.button,
                },
                props.cta,
              ),
              h(
                "p",
                {
                  style: styles.linkHelp,
                },
                "If the button does not open, paste this URL into your browser:",
              ),
              h(
                "p",
                {
                  style: styles.linkText,
                },
                props.url,
              ),
            ),
          ),
          h(
            "tr",
            null,
            h(
              "td",
              {
                style: styles.footer,
              },
              "This email was sent because someone requested access to Quieter.",
            ),
          ),
        ),
      ),
    ),
  );

export const VerificationEmail = (props: { url: string }) =>
  createAuthActionEmail({
    body: "Confirm this email address to finish setting up Quieter.",
    cta: "Verify email",
    preview: "Confirm this email address to finish setting up Quieter.",
    title: "Verify your Quieter email",
    url: props.url,
  });

export const MagicLinkEmail = (props: { url: string }) =>
  createAuthActionEmail({
    body: "Use this link to sign in to Quieter.",
    cta: "Sign in",
    preview: "Use this link to sign in to Quieter.",
    title: "Sign in to Quieter",
    url: props.url,
  });
