import { render } from "@react-email/render";
import type { ReactElement } from "react";

import { Quieter as QuieterClient } from "./index";
import type {
  QuieterSendInput as CoreSendInput,
  QuieterSendOptions,
  QuieterSendResult,
} from "./index";

export * from "./index";
export type QuieterSendInput =
  | CoreSendInput
  | (Omit<CoreSendInput, "html"> & { html?: never; react: ReactElement });

export class Quieter extends QuieterClient {
  override async send(
    input: QuieterSendInput,
    options: QuieterSendOptions = {}
  ): Promise<QuieterSendResult> {
    if (!("react" in input)) {
      return await super.send(input, options);
    }
    const { react, ...message } = input;
    return await super.send({ ...message, html: await render(react) }, options);
  }
}
