const activeRunControllers = new Map<string, AbortController>();

export const registerChatRunController = (runId: string, controller: AbortController) => {
  activeRunControllers.set(runId, controller);

  return () => {
    if (activeRunControllers.get(runId) === controller) {
      activeRunControllers.delete(runId);
    }
  };
};

export const abortChatRun = (runId: string) => {
  const controller = activeRunControllers.get(runId);
  controller?.abort();
  return !!controller;
};
