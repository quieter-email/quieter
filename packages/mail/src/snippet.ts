import { Tokenizer } from "htmlparser2";

const ignoreToken = () => {
  // Snippets need text boundaries, not attributes or decoded entities.
};

export const createMailSnippet = (input: {
  bodyHtml?: string;
  bodyText?: string;
  includeScriptAndStyleText?: boolean;
}): string | undefined => {
  const source = input.bodyText ?? input.bodyHtml;
  if (source === undefined) {
    return undefined;
  }

  let snippet = "";
  let whitespace = false;
  let hiddenTag: "script" | "style" | undefined;
  let rawText = false;
  const appendText = (start: number, end: number) => {
    if (hiddenTag !== undefined) {
      return;
    }
    for (let index = start; index < end && snippet.length < 240; index += 1) {
      const character = source.charAt(index);
      if (/\s/u.test(character)) {
        whitespace = snippet.length > 0;
      } else {
        snippet = `${snippet}${whitespace ? " " : ""}${character}`.slice(
          0,
          240
        );
        whitespace = false;
      }
    }
  };

  if (input.bodyText === undefined) {
    // Use the tokenizer directly to avoid DOM construction and ancestor searches
    // on deeply nested or mismatched attacker-controlled markup.
    const tokenizer = new Tokenizer(
      { decodeEntities: false },
      {
        onattribdata: ignoreToken,
        onattribend: ignoreToken,
        onattribentity: ignoreToken,
        onattribname: ignoreToken,
        oncdata: ignoreToken,
        onclosetag: (start, end) => {
          if (source.slice(start, end).toLowerCase() === hiddenTag) {
            hiddenTag = undefined;
          }
          rawText = false;
          whitespace = snippet.length > 0;
        },
        oncomment: () => {
          whitespace = snippet.length > 0;
        },
        ondeclaration: () => {
          whitespace = snippet.length > 0;
        },
        onend: ignoreToken,
        onopentagend: ignoreToken,
        onopentagname: (start, end) => {
          const name = source.slice(start, end).toLowerCase();
          rawText =
            name === "script" ||
            name === "style" ||
            name === "title" ||
            name === "textarea" ||
            name === "xmp";
          if (
            input.includeScriptAndStyleText !== true &&
            (name === "script" || name === "style")
          ) {
            hiddenTag = name;
          }
          whitespace = snippet.length > 0;
        },
        onprocessinginstruction: () => {
          whitespace = snippet.length > 0;
        },
        onselfclosingtag: ignoreToken,
        ontext: (start, end) => {
          if (rawText && hiddenTag === undefined) {
            // Existing snippets strip markup even inside raw-text elements.
            const text = source.slice(start, end);
            let cursor = 0;
            while (cursor < text.length && snippet.length < 240) {
              const tagStart = text.indexOf("<", cursor);
              const tagEnd =
                tagStart === -1 ? -1 : text.indexOf(">", tagStart + 2);
              if (tagEnd === -1) {
                appendText(start + cursor, end);
                break;
              }
              appendText(start + cursor, start + tagStart);
              whitespace = snippet.length > 0;
              cursor = tagEnd + 1;
            }
          } else {
            appendText(start, end);
          }
          if (snippet.length === 240) {
            tokenizer.pause();
          }
        },
        ontextentity: ignoreToken,
      }
    );
    tokenizer.write(source);
    tokenizer.end();
  } else {
    appendText(0, source.length);
  }

  return snippet.length > 0 ? snippet : undefined;
};
