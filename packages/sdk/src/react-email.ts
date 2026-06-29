import { render } from "@react-email/render";
import type { Quieter, QuieterSendInput, QuieterSendOptions, QuieterSendResult } from "./index";

export type QuieterReactEmailInput = Omit<QuieterSendInput, "html" | "react"> & {
  react: unknown;
};

export const renderQuieterReactEmail = async (input: QuieterReactEmailInput) => {
  const { react, ...message } = input;
  return {
    ...message,
    html: await render(react),
    text: input.text ?? (await render(react, { plainText: true })),
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
