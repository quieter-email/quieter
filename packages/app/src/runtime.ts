type AppRuntime = {
  apiBaseURL?: string;
  fetch?: typeof globalThis.fetch;
  openExternal?: (url: string) => void | Promise<void>;
  platform?: "desktop" | "web";
};

export const appRuntime: AppRuntime = {};

export const configureAppRuntime = (options: AppRuntime) => {
  Object.assign(appRuntime, {
    apiBaseURL: options.apiBaseURL,
    fetch: options.fetch,
    openExternal: options.openExternal,
    platform: options.platform,
  });
};

export const getApiUrl = (pathname: string) =>
  appRuntime.apiBaseURL
    ? new URL(pathname, appRuntime.apiBaseURL).toString()
    : pathname;

export const appFetch: typeof globalThis.fetch = async (input, init) =>
  await (appRuntime.fetch ?? globalThis.fetch)(input, init);

export const openExternalUrl = async (url: string) => {
  if (appRuntime.openExternal) {
    await appRuntime.openExternal(url);
    return;
  }

  window.location.assign(url);
};
