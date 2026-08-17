const activeRunControllers = new Map<string, AbortController>();

export const registerChatRunController = (
  runId: string,
  controller: AbortController
) => {
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

/** Whether this isolate is already producing the run, so a second one must not start. */
export const isChatRunProducerActive = (runId: string) =>
  activeRunControllers.has(runId);
