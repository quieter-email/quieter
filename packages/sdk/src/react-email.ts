import { render } from "@react-email/render";
import type {
  Quieter,
  QuieterReactElement,
  QuieterSendInput,
  QuieterSendOptions,
  QuieterSendResult,
} from "./index";

export type QuieterReactEmailInput = Omit<QuieterSendInput, "html" | "react"> & {
  react: QuieterReactElement;
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
