import {
  extractMailAddress,
  getMailAddressKey,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";

export type RecipientCompletion = Readonly<{
  end: number;
  prefix: string;
  query: string;
  start: number;
}>;

export type RecipientSuggestion = { email: string; name: string | null };

const addressQueryPattern =
  /^[^\s"(),:;<>@[\\\]]{0,64}(?:@[^\s"(),:;<>@[\\\]]*)?$/u;
const nameQueryPattern =
  /^(?=.{1,64}$)[\p{L}\p{M}\p{N}.'’&-]+(?: [\p{L}\p{M}\p{N}.'’&-]+){1,3}$/u;

/**
 * Finds the recipient being typed at the caret. Returns null when that part of
 * the list is quoted text, a comment, or anything else that is not a plausible
 * name or address, so it never leaves the composer as a lookup.
 */
export const getRecipientCompletion = (
  value: string,
  caret: number
): RecipientCompletion | null => {
  // The trailing marker keeps the address grammar from trimming the caret's
  // position or dropping an empty final entry.
  const head = splitMailAddressList(`${value.slice(0, caret)}x`).at(-1);
  if (head === undefined || head.length === 1) {
    return null;
  }
  const start = caret - (head.length - 1);
  const text = splitMailAddressList(value.slice(start))[0] ?? "";
  const end = Math.max(caret, start + text.length);

  let query = text;
  let prefix = "";
  if (text.includes("<")) {
    const mailbox = text.endsWith(">") ? text : `${text}>`;
    const address = extractMailAddress(mailbox);
    if (address === mailbox || !addressQueryPattern.test(address)) {
      return null;
    }
    const addressStart = text.lastIndexOf("<") + 1;
    if (caret < start + addressStart) {
      return null;
    }
    query = address;
    prefix = text.slice(0, addressStart);
  } else if (!addressQueryPattern.test(text) && !nameQueryPattern.test(text)) {
    return null;
  }
  return query.length < 2 || query.length > 254
    ? null
    : { end, prefix, query, start };
};

export const applyRecipientCompletion = (
  value: string,
  { end, prefix, start }: RecipientCompletion,
  email: string
) => {
  const completed = `${value.slice(0, start)}${prefix}${email}${prefix ? ">" : ""}`;
  const rest = value.slice(end);
  return rest.trim()
    ? { caret: completed.length, value: `${completed}${rest}` }
    : { caret: completed.length + 2, value: `${completed}, ` };
};

export const filterRecipientSuggestions = ({
  completion,
  otherFields,
  suggestions,
  value,
}: {
  completion: RecipientCompletion;
  otherFields: readonly string[];
  suggestions: readonly RecipientSuggestion[];
  value: string;
}) => {
  const seen = new Set(
    [
      value.slice(0, completion.start),
      completion.query,
      value.slice(completion.end),
      ...otherFields,
    ]
      .flatMap(splitMailAddressList)
      .map(getMailAddressKey)
  );
  return suggestions.filter(({ email }) => {
    const key = getMailAddressKey(email);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};
