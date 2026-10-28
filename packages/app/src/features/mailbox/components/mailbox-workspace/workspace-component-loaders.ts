const createPreloadableWorkspaceLoader = <Module>(
  load: () => Promise<Module>
) => {
  // oxlint-disable-next-line typescript/promise-function-async -- Return the observed promise itself, without creating another async promise.
  const loadWorkspace = () => {
    const loading = load();
    // Intent preloads may ignore this promise; mounted consumers still receive its rejection.
    void Promise.allSettled([loading]);
    return loading;
  };
  return loadWorkspace;
};

export const loadChatView = createPreloadableWorkspaceLoader(async () => {
  const { ChatView: Component } =
    await import("@quieter/app/features/chat/components/chat-view");
  return { default: Component };
});

export const loadComposeWorkspace = createPreloadableWorkspaceLoader(
  async () => {
    const { ComposeWorkspace: Component } =
      await import("@quieter/app/features/compose/components/compose-workspace");
    return { default: Component };
  }
);

export const loadSnippetWorkspace = createPreloadableWorkspaceLoader(
  async () => {
    const { SnippetWorkspace: Component } =
      await import("@quieter/app/features/compose/components/snippet-workspace");
    return { default: Component };
  }
);
