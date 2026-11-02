import { render, toPlainText } from "@react-email/render";
import type { ReactElement } from "react";

import { Quieter as QuieterClient } from "./index";
import type {
  ControlInput,
  ControlOutput,
  EmailContent,
  QuieterOptions,
  QuieterRequestOptions,
  QuieterSendInput as CoreSendInput,
  QuieterSendOptions,
  QuieterSendResult,
} from "./index";

// oxlint-disable-next-line oxc/no-barrel-file -- The React entry preserves the core SDK exports.
export * from "./index";
type ReactInput<T> =
  | T
  | (Omit<T, "content" | "text"> & {
      content?: never;
      react: ReactElement;
      text?: string;
    });
export type QuieterReactCampaignCreateInput = ReactInput<
  ControlInput<"campaigns.create">
>;
export type QuieterReactCampaignUpdateInput = ReactInput<
  ControlInput<"campaigns.update">
>;
export type QuieterReactTemplateCreateInput = ReactInput<
  ControlInput<"templates.create">
>;
export type QuieterReactTemplateUpdateInput = ReactInput<
  ControlInput<"templates.update">
>;
export type QuieterSendInput =
  | CoreSendInput
  | (Omit<CoreSendInput, "html" | "text"> & {
      html?: never;
      react: ReactElement;
      text?: string;
    });

export const renderReactEmail = async (
  element: ReactElement,
  text?: string
): Promise<Extract<EmailContent, { kind: "html" }>> => {
  const html = await render(element);
  return { html, kind: "html", text: text ?? toPlainText(html) };
};

type ReactCampaignMethods = Omit<
  QuieterClient["campaigns"],
  "create" | "update"
> & {
  create: (
    input: QuieterReactCampaignCreateInput,
    options?: QuieterRequestOptions
  ) => Promise<ControlOutput<"campaigns.create">>;
  update: (
    input: QuieterReactCampaignUpdateInput,
    options?: QuieterRequestOptions
  ) => Promise<ControlOutput<"campaigns.update">>;
};
type ReactTemplateMethods = Omit<
  QuieterClient["templates"],
  "create" | "update"
> & {
  create: (
    input: QuieterReactTemplateCreateInput,
    options?: QuieterRequestOptions
  ) => Promise<ControlOutput<"templates.create">>;
  update: (
    input: QuieterReactTemplateUpdateInput,
    options?: QuieterRequestOptions
  ) => Promise<ControlOutput<"templates.update">>;
};

export class Quieter extends QuieterClient {
  declare readonly campaigns: ReactCampaignMethods;
  declare readonly templates: ReactTemplateMethods;

  constructor(options: QuieterOptions) {
    super(options);
    const createCampaign = this.campaigns.create;
    const updateCampaign = this.campaigns.update;
    const createTemplate = this.templates.create;
    const updateTemplate = this.templates.update;
    this.campaigns.create = async (input, requestOptions) => {
      if (!("react" in input)) {
        return await createCampaign(input, requestOptions);
      }
      const { react, text, ...campaign } = input;
      return await createCampaign(
        { ...campaign, content: await renderReactEmail(react, text) },
        requestOptions
      );
    };
    this.campaigns.update = async (input, requestOptions) => {
      if (!("react" in input)) {
        return await updateCampaign(input, requestOptions);
      }
      const { react, text, ...campaign } = input;
      return await updateCampaign(
        { ...campaign, content: await renderReactEmail(react, text) },
        requestOptions
      );
    };
    this.templates.create = async (input, requestOptions) => {
      if (!("react" in input)) {
        return await createTemplate(input, requestOptions);
      }
      const { react, text, ...template } = input;
      return await createTemplate(
        { ...template, content: await renderReactEmail(react, text) },
        requestOptions
      );
    };
    this.templates.update = async (input, requestOptions) => {
      if (!("react" in input)) {
        return await updateTemplate(input, requestOptions);
      }
      const { react, text, ...template } = input;
      return await updateTemplate(
        { ...template, content: await renderReactEmail(react, text) },
        requestOptions
      );
    };
  }

  override async send(
    input: QuieterSendInput,
    options: QuieterSendOptions = {}
  ): Promise<QuieterSendResult> {
    if (!("react" in input)) {
      return await super.send(input, options);
    }
    const { react, ...message } = input;
    const content = await renderReactEmail(react, message.text);
    return await super.send(
      { ...message, html: content.html, text: content.text },
      options
    );
  }
}
