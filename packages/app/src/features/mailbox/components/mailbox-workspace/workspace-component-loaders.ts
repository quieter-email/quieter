export const loadChatView = async () =>
  await import("@quieter/app/features/chat/components/chat-view").then(
    ({ ChatView: Component }) => ({ default: Component })
  );

export const loadComposeWorkspace = async () =>
  await import("@quieter/app/features/compose/components/compose-workspace").then(
    ({ ComposeWorkspace: Component }) => ({ default: Component })
  );

export const loadSnippetWorkspace = async () =>
  await import("@quieter/app/features/compose/components/snippet-workspace").then(
    ({ SnippetWorkspace: Component }) => ({ default: Component })
  );
