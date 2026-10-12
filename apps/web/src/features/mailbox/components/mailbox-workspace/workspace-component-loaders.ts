export const loadChatView = async () =>
  await import("#/features/chat/components/chat-view").then(
    ({ ChatView: Component }) => ({ default: Component })
  );

export const loadComposeWorkspace = async () =>
  await import("#/features/compose/components/compose-workspace").then(
    ({ ComposeWorkspace: Component }) => ({ default: Component })
  );

export const loadSnippetWorkspace = async () =>
  await import("#/features/compose/components/snippet-workspace").then(
    ({ SnippetWorkspace: Component }) => ({ default: Component })
  );
