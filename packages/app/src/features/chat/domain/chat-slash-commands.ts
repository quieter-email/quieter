import type { CommandMenuItem } from "@quieter/ui/command-menu";

import { getChatModelItems } from "./chat-model-options";
import type { ChatModelItem } from "./chat-model-options";

type ChatSlashCommand = {
  from: number;
  to: number;
  kind: "commands" | "model" | "snippet";
  query: string;
};

type ChatSlashItem =
  | ChatModelItem
  | (Omit<CommandMenuItem, "icon"> &
      (
        | { kind: "search"; command: "model" | "snippet" }
        | { kind: "snippet"; text: string }
      ));

const commands: ChatSlashItem[] = [
  {
    command: "model",
    description: "/model",
    group: "Commands",
    id: "search-model",
    kind: "search",
    label: "Choose model",
  },
  {
    command: "snippet",
    description: "/snippet",
    group: "Commands",
    id: "search-snippet",
    kind: "search",
    label: "Insert snippet",
  },
];

export const getChatSlashCommand = (
  value: string,
  selectionStart: number,
  selectionEnd: number
): ChatSlashCommand | null => {
  if (selectionStart !== selectionEnd) {
    return null;
  }
  const beforeCaret = value.slice(0, selectionStart);
  const lineStart = beforeCaret.lastIndexOf("\n") + 1;
  const query = /(?:^|[ \t])\/(?<query>[^/\n]*)$/u.exec(
    beforeCaret.slice(lineStart)
  )?.groups?.query;
  if (query === undefined) {
    return null;
  }
  const named = /^(?<kind>model|snippet)(?:[ \t]+(?<search>.*))?$/iu.exec(
    query
  )?.groups;
  const kind = named?.kind?.toLowerCase();
  return {
    from: selectionStart - query.length - 1,
    kind: kind === "model" || kind === "snippet" ? kind : "commands",
    query: named === undefined ? query : (named.search ?? ""),
    to: selectionStart,
  };
};

export const getChatSlashItems = (
  command: ChatSlashCommand,
  snippets: readonly { bodyText: string; id: string; name: string }[]
): ChatSlashItem[] => {
  if (command.kind === "model") {
    return getChatModelItems(command.query);
  }
  const search = command.query.toLocaleLowerCase().replaceAll(/\s+/gu, "");
  const matchingSnippets: ChatSlashItem[] = snippets
    .filter((snippet) =>
      snippet.name.toLocaleLowerCase().replaceAll(/\s+/gu, "").includes(search)
    )
    .map((snippet) => ({
      description: snippet.bodyText,
      group: "Snippets",
      id: `snippet-${snippet.id}`,
      kind: "snippet",
      label: snippet.name,
      text: snippet.bodyText.replaceAll(/\r\n?/gu, "\n"),
    }));
  return command.kind === "snippet"
    ? matchingSnippets
    : [
        ...commands.filter((item) =>
          `${item.label} ${item.description ?? ""}`
            .toLocaleLowerCase()
            .replaceAll(/\s+/gu, "")
            .includes(search)
        ),
        ...matchingSnippets,
      ];
};
