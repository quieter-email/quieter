import type { ReactElement } from "react";
import { render } from "@react-email/render";
import type { Quieter, QuieterSendBaseInput, QuieterSendOptions, QuieterSendResult } from "./index";

export type QuieterReactEmailInput = QuieterSendBaseInput & {
  react: ReactElement;
};

export const renderQuieterReactEmail = async (input: QuieterReactEmailInput) => {
  const { react, ...message } = input;
  return {
    ...message,
    html: await render(react),
  };
};

export const sendReactEmail = async (
  client: Quieter,
  input: QuieterReactEmailInput,
  options?: QuieterSendOptions,
): Promise<QuieterSendResult> => {
  const message = await renderQuieterReactEmail(input);
  return await client.send(message, options);
};
