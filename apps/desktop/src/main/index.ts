import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { electronClient } from "@better-auth/electron/client";
import {
  DESKTOP_AUTH_BROWSER_PATH,
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_CLIENT_ID,
  DESKTOP_AUTH_PROTOCOL_SCHEME,
} from "@quieter/auth/desktop";
import { createWebClientEnv } from "@quieter/env/client";
import { createDesktopEnv } from "@quieter/env/desktop";
import { prepareReportedEvent } from "@quieter/observability";
import * as Sentry from "@sentry/node";
import { createAuthClient } from "better-auth/client";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import type { IpcMainInvokeEvent } from "electron";

import { DESKTOP_APP_ORIGIN, DESKTOP_TITLE_BAR_HEIGHT } from "../shared/bridge";
import { createAuthStorage } from "./auth-storage";
import {
  getAuthCallbackToken,
  getExternalURL,
  isTrustedRendererURL,
  resolveApiTarget,
  resolveRendererFile,
  sanitizeAuthResponse,
} from "./security";
import { SignOutCleanup } from "./sign-out-cleanup";

// oxlint-disable-next-line node/no-process-env -- Electron's main entrypoint is the environment bootstrap.
const env = createDesktopEnv(process.env);
const clientEnv = createWebClientEnv(import.meta.env);
app.setName("quieter");
Sentry.init({
  beforeSend: (event, hint) =>
    prepareReportedEvent(event, hint.originalException),
  defaultIntegrations: false,
  dsn: clientEnv.VITE_SENTRY_DSN,
  enabled:
    clientEnv.VITE_SENTRY_DSN !== undefined &&
    (app.isPackaged || clientEnv.VITE_QUIETER_LOCAL_TELEMETRY === "true"),
  environment: app.isPackaged ? "production" : "development",
  release: `quieter-desktop@${app.getVersion()}`,
});
const developmentURL = app.isPackaged ? undefined : env.ELECTRON_RENDERER_URL;
const directory = import.meta.dirname;
let mainWindow: BrowserWindow | null = null;
const credentials = createAuthStorage(() => {
  mainWindow?.webContents.send("better-auth:error", {
    message:
      "Your sign-in could not be saved securely. Check the available disk space and reopen quieter.",
    status: 500,
  });
});
let initialized = false;
let quitting = false;
const pendingTokens: string[] = [];
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self'${developmentURL ? " 'unsafe-inline'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${DESKTOP_APP_ORIGIN} ${new URL(env.DESKTOP_MAIL_UPDATES_URL).origin}${clientEnv.VITE_SENTRY_DSN ? ` ${new URL(clientEnv.VITE_SENTRY_DSN).origin}` : ""}${developmentURL ? ` ${new URL(developmentURL).origin} ${new URL(developmentURL).origin.replace(/^http/u, "ws")}` : ""}`,
  "frame-src 'self' about: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: "quieter-app",
  },
  { privileges: { secure: true }, scheme: DESKTOP_AUTH_PROTOCOL_SCHEME },
]);

const authClient = createAuthClient({
  baseURL: env.DESKTOP_SERVER_URL,
  fetchOptions: { redirect: "manual" },
  plugins: [
    electronClient({
      callbackPath: DESKTOP_AUTH_CALLBACK_PATH,
      clientID: DESKTOP_AUTH_CLIENT_ID,
      disableCache: true,
      protocol: { scheme: DESKTOP_AUTH_PROTOCOL_SCHEME },
      sanitizeUser: (user) => ({
        createdAt: user.createdAt,
        email: user.email,
        emailVerified: user.emailVerified,
        id: user.id,
        image: user.image,
        name: user.name,
        updatedAt: user.updatedAt,
      }),
      signInURL: new URL(DESKTOP_AUTH_BROWSER_PATH, env.DESKTOP_SERVER_URL),
      storage: credentials.storage,
      storagePrefix: `quieter.${new URL(env.DESKTOP_SERVER_URL).origin}`,
      userImageProxy: { enabled: false },
    }),
  ],
});

// Keep the SDK's encrypted cookie handling and PKCE flow behind guarded IPC.
authClient.setupMain({
  bridges: false,
  csp: false,
  getWindow: () => mainWindow,
  scheme: false,
});

const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isTrustedRendererURL(event.senderFrame.url, developmentURL)
  ) {
    throw new Error("This window cannot access quieter.");
  }
};

ipcMain.handle("better-auth:getUser", async (event) => {
  assertTrustedSender(event);
  const result = await authClient.getSession();
  return result.data?.user ? sanitizeAuthResponse(result.data.user) : null;
});
ipcMain.handle("better-auth:requestAuth", async (event) => {
  assertTrustedSender(event);
  await authClient.requestAuth();
});
ipcMain.handle("better-auth:authenticate", async (event, data: unknown) => {
  assertTrustedSender(event);
  if (
    data === null ||
    typeof data !== "object" ||
    !("token" in data) ||
    typeof data.token !== "string" ||
    data.token.length > 4096
  ) {
    throw new Error("Enter the sign-in code from your browser.");
  }
  const result = await authClient.authenticate({ token: data.token });
  if (result.error) {
    throw new Error(
      result.error.message ??
        "Sign-in could not be completed. Try signing in again."
    );
  }
});
const signOutCleanup = new SignOutCleanup();
ipcMain.handle("quieter:sign-out-cleanup-ack", (event, input: unknown) => {
  assertTrustedSender(event);
  signOutCleanup.acknowledge(input);
});
ipcMain.handle("better-auth:signOut", async (event) => {
  assertTrustedSender(event);
  const frame = event.senderFrame;
  await signOutCleanup.run({
    onCompletionError: () => {
      Sentry.captureException(
        new Error("Desktop sign-out completion failed."),
        {
          tags: { boundary: "desktop-sign-out-cache" },
        }
      );
    },
    onSignedOut: () => {
      if (!event.sender.isDestroyed() && event.sender.mainFrame === frame) {
        event.sender.send("better-auth:user-updated", null);
      }
    },
    send: (command) => {
      assertTrustedSender(event);
      if (event.sender.mainFrame !== frame) {
        throw new Error("The sign-out window changed. Try again.");
      }
      event.sender.send("quieter:sign-out-cleanup", command);
    },
    signOut: async () => {
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error(
          result.error.message ?? "Sign-out could not be completed. Try again."
        );
      }
    },
  });
});
ipcMain.handle("quieter:open-external", async (event, input: unknown) => {
  assertTrustedSender(event);
  const url = getExternalURL(input, env.DESKTOP_SERVER_URL);
  if (!url) {
    throw new Error("This link cannot be opened.");
  }
  await shell.openExternal(url);
});
ipcMain.handle("quieter:set-title-bar-colors", (event, input: unknown) => {
  assertTrustedSender(event);
  if (
    input === null ||
    typeof input !== "object" ||
    !("background" in input) ||
    typeof input.background !== "string" ||
    !/^#[\da-f]{6}$/iu.test(input.background) ||
    !("foreground" in input) ||
    typeof input.foreground !== "string" ||
    !/^#[\da-f]{6}$/iu.test(input.foreground)
  ) {
    throw new Error("This window appearance cannot be applied.");
  }
  if (process.platform === "win32" || process.platform === "linux") {
    mainWindow?.setTitleBarOverlay({
      color: input.background,
      symbolColor: input.foreground,
    });
  }
});

const completeAuthentication = async (token: string): Promise<void> => {
  if (!initialized) {
    pendingTokens.push(token);
    return;
  }
  try {
    const result = await authClient.authenticate({ token });
    if (result.error) {
      mainWindow?.webContents.send("better-auth:error", {
        message:
          result.error.message ?? "Sign-in could not be completed. Try again.",
        status: result.error.status,
      });
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { boundary: "desktop-auth" } });
    mainWindow?.webContents.send("better-auth:error", {
      message: "Sign-in could not be completed. Please try again.",
      status: 500,
    });
  }
};

app.on("open-url", (event, url) => {
  event.preventDefault();
  const token = getAuthCallbackToken(url);
  if (token) {
    void completeAuthentication(token);
  }
});

const hasInstanceLock = app.requestSingleInstanceLock();
if (hasInstanceLock) {
  app.on("second-instance", (_event, commandLine) => {
    if (mainWindow?.isMinimized() === true) {
      mainWindow.restore();
    }
    mainWindow?.show();
    mainWindow?.focus();
    for (const argument of commandLine) {
      const token = getAuthCallbackToken(argument);
      if (token) {
        void completeAuthentication(token);
        break;
      }
    }
  });
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(
      DESKTOP_AUTH_PROTOCOL_SCHEME,
      process.execPath,
      [path.resolve(process.argv[1])]
    );
  } else {
    app.setAsDefaultProtocolClient(DESKTOP_AUTH_PROTOCOL_SCHEME);
  }
} else {
  app.quit();
}

const proxyRequest = async (
  request: Request,
  target: URL
): Promise<Response> => {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  if (origin && !isTrustedRendererURL(origin, developmentURL)) {
    return new Response(null, { status: 403 });
  }
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
  }
  headers.set(
    "access-control-allow-headers",
    "content-type, last-event-id, x-orpc-batch, x-orpc-source"
  );
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("cache-control", "no-store");
  if (request.method === "OPTIONS") {
    return new Response(null, { headers, status: 204 });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(null, { headers, status: 405 });
  }
  if (target.pathname.startsWith("/api/auth/")) {
    let status = 200;
    const body: unknown =
      request.method === "POST" ? await request.json() : undefined;
    const result = await authClient.$fetch<unknown>(
      `${target.pathname.slice("/api/auth".length)}${target.search}`,
      {
        body,
        method: request.method,
        onResponse: (context) => {
          ({ status } = context.response);
        },
        signal: request.signal,
      }
    );
    return status === 204
      ? new Response(null, { headers, status })
      : Response.json(sanitizeAuthResponse(result.error ?? result.data), {
          headers,
          status,
        });
  }
  const upstreamHeaders = new Headers();
  for (const name of [
    "accept",
    "content-type",
    "last-event-id",
    "x-orpc-batch",
    "x-orpc-source",
  ]) {
    const value = request.headers.get(name);
    if (value) {
      upstreamHeaders.set(name, value);
    }
  }
  upstreamHeaders.set("cookie", authClient.getCookie());
  upstreamHeaders.set("origin", `${DESKTOP_AUTH_PROTOCOL_SCHEME}:/`);
  const init = {
    body: request.method === "POST" ? request.body : undefined,
    duplex: "half",
    headers: upstreamHeaders,
    method: request.method,
    redirect: "manual" as const,
    signal: request.signal,
  };
  const response = await fetch(target, init);
  if (response.status >= 300 && response.status < 400) {
    return Response.json(
      { message: "Sign in to continue." },
      { headers, status: 401 }
    );
  }
  for (const name of [
    "content-type",
    "content-disposition",
    "x-vercel-ai-ui-message-stream",
  ]) {
    const value = response.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return new Response(response.body, { headers, status: response.status });
};

const installAppProtocol = (): void => {
  const rendererRoot = path.join(directory, "../renderer");
  protocol.handle("quieter-app", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        const target = resolveApiTarget(request.url, env.DESKTOP_SERVER_URL);
        return target
          ? await proxyRequest(request, target)
          : new Response(null, { status: 403 });
      }
      let file = resolveRendererFile(rendererRoot, request.url);
      if (!file) {
        return new Response(null, { status: 403 });
      }
      try {
        const entry = await stat(file);
        if (!entry.isFile()) {
          file = path.join(rendererRoot, "index.html");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT" &&
          path.extname(file) === ""
        ) {
          file = path.join(rendererRoot, "index.html");
        } else {
          return new Response(null, { status: 404 });
        }
      }
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set("content-security-policy", contentSecurityPolicy);
      headers.set("x-content-type-options", "nosniff");
      return new Response(response.body, { headers, status: response.status });
    } catch (error) {
      if (!request.signal.aborted) {
        Sentry.captureException(error, {
          tags: { boundary: "desktop-protocol" },
        });
      }
      return Response.json(
        { message: "Something went wrong. Please try again." },
        { status: 502 }
      );
    }
  });
};

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    height: 900,
    icon: path.join(app.getAppPath(), "resources/icon.png"),
    minHeight: 620,
    minWidth: 900,
    show: false,
    title: "quieter",
    titleBarOverlay: {
      ...(process.platform === "darwin" ? {} : { color: "#00000000" }),
      height: DESKTOP_TITLE_BAR_HEIGHT,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(directory, "../preload/index.cjs"),
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
    width: 1440,
  });
  const window = mainWindow;
  window.once("ready-to-show", () => {
    window.show();
  });
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) {
        signOutCleanup.cancel();
      }
    }
  );
  window.webContents.on("render-process-gone", () => {
    signOutCleanup.cancel();
  });
  window.on("closed", () => {
    signOutCleanup.cancel();
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererURL(url, developmentURL)) {
      event.preventDefault();
      const external = getExternalURL(url, env.DESKTOP_SERVER_URL);
      if (external) {
        void shell.openExternal(external);
      }
    }
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedRendererURL(url, developmentURL)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const external = getExternalURL(url, env.DESKTOP_SERVER_URL);
    if (external) {
      void shell.openExternal(external);
    }
    return { action: "deny" };
  });
  await window.loadURL(developmentURL ?? `${DESKTOP_APP_ORIGIN}/`);
};

const startApp = async (): Promise<void> => {
  try {
    await app.whenReady();
    app.setAppUserModelId(DESKTOP_AUTH_PROTOCOL_SCHEME);
    await credentials.initialize();
    // oxlint-disable promise/prefer-await-to-callbacks -- Electron's permission API requires callbacks.
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        const trusted =
          contents === mainWindow?.webContents &&
          details.isMainFrame &&
          isTrustedRendererURL(details.requestingUrl, developmentURL);
        callback(
          trusted &&
            (permission === "clipboard-sanitized-write" ||
              (permission === "media" &&
                "mediaTypes" in details &&
                Array.isArray(details.mediaTypes) &&
                details.mediaTypes.length === 1 &&
                details.mediaTypes[0] === "audio"))
        );
      }
    );
    // oxlint-enable promise/prefer-await-to-callbacks
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, origin, details) => {
        const trusted =
          contents === mainWindow?.webContents &&
          details.isMainFrame &&
          isTrustedRendererURL(origin, developmentURL);
        return (
          trusted &&
          (permission === "clipboard-sanitized-write" ||
            (permission === "media" && details.mediaType === "audio"))
        );
      }
    );
    // oxlint-disable promise/prefer-await-to-callbacks -- Electron's header interception API requires callbacks.
    // Packaged app schemes cannot supply the HTTPS referrer expected by image services.
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ["https://*/*"] },
      (details, callback) => {
        if (
          details.webContentsId === mainWindow?.webContents.id &&
          details.frame === mainWindow?.webContents.mainFrame &&
          details.resourceType === "image"
        ) {
          callback({
            requestHeaders: {
              ...details.requestHeaders,
              Referer: `${new URL(env.DESKTOP_SERVER_URL).origin}/`,
            },
          });
          return;
        }
        callback({});
      }
    );
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (isTrustedRendererURL(details.url, developmentURL)) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [contentSecurityPolicy],
          },
        });
        return;
      }
      callback({});
    });
    // oxlint-enable promise/prefer-await-to-callbacks
    installAppProtocol();
    await createWindow();
    initialized = true;
    for (const argument of process.argv) {
      const token = getAuthCallbackToken(argument);
      if (token) {
        pendingTokens.push(token);
        break;
      }
    }
    for (const token of pendingTokens.splice(0)) {
      await completeAuthentication(token);
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { boundary: "desktop-startup" } });
    await Sentry.flush(2000);
    dialog.showErrorBox(
      "quieter could not start",
      "Secure sign-in or the app window could not be initialized. Check your system keychain and reopen quieter."
    );
    app.quit();
  }
};

if (hasInstanceLock) {
  void startApp();
}

app.on("activate", () => {
  if (initialized && !mainWindow) {
    void createWindow();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
const flushCredentialsAndQuit = async (): Promise<void> => {
  try {
    await credentials.flush();
  } catch {
    dialog.showErrorBox(
      "Sign-in could not be saved",
      "quieter could not save your sign-in securely. You may need to sign in again next time."
    );
  } finally {
    await Sentry.flush(2000);
    app.quit();
  }
};

app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault();
    quitting = true;
    void flushCredentialsAndQuit();
  }
});
