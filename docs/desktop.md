# Electron desktop

`apps/desktop` packages the React application locally with Electron 44, electron-vite 6, Vite+, and electron-builder. It shares mail, compose, chat, settings, onboarding, shortcuts, query persistence, and styles with the website through `@quieter/app`. It uses the same `@quieter/ui` design system. Web server functions and marketing pages remain in `apps/web`.

Web and desktop auth use the same centered `AuthLayout` and the landing page's closing atmospheric shader.

## Local development

Run the normal isolated development setup first:

```sh
vp install
vp run dev:setup
vp run dev
```

In a second terminal:

```sh
vp run dev:desktop
```

The web backend defaults to `http://localhost:3000`, the desktop renderer uses `127.0.0.1:5178`, and live updates use `ws://127.0.0.1:8787/mail/live`. `dev:desktop` never defaults to production. Check occupied ports before starting either process. Use an ignored `.env.desktop.local` to set `DESKTOP_SERVER_URL` and `DESKTOP_MAIL_UPDATES_URL` when using different development ports. Set the renderer port in `apps/desktop/electron.vite.config.ts` if 5178 is occupied. Keep the backend's public URL and identity callback URLs consistent with the selected backend port. Run `vp run env:doctor` after local configuration changes.

Start `vp run dev:workers` separately when verifying live mail updates or mail processing. Existing development mailbox ownership rules still apply; desktop does not start background mail processing itself. Never enable competing Gmail watches or write to a shared external mailbox without dedicated test ownership. Stop the Electron process and development server trees after verification.

## Authentication and browser flows

The desktop welcome screen opens `/desktop/auth` in the system browser using `@better-auth/electron`, preserving its PKCE challenge and state. Existing browser sessions can approve the desktop directly. Successful authentication returns through `com.quieter.desktop:/auth/callback`; the browser also offers a short-lived code when protocol registration is unavailable. The code can only be redeemed by the app that started that sign-in. Google identity and Gmail permissions remain separate.

Electron keeps sessions in the main process. Its storage is encrypted using the operating system keychain, and credentials are scoped to the backend origin. Linux requires a supported Secret Service or KWallet backend; plaintext storage is refused. The renderer has no Node integration and runs sandboxed with context isolation. Guarded IPC and an allowlisted `quieter-app://app/api` proxy keep session cookies out of the renderer. Chat responses stream through the proxy; signed live-update sockets connect only to the configured origin.

Gmail connection, external connectors, checkout, legal pages, and passkey management open in the system browser. Returning to the desktop refreshes server state. Browser analytics and consent scripts are not initialized by the desktop entrypoint.

## Build and package

```sh
vp run build:desktop
vp run package:desktop
vp run @quieter/desktop#dist
```

`package:desktop` produces an unpacked application under `apps/desktop/release`; `dist` produces the host platform's installer (NSIS on Windows, DMG/ZIP on macOS, AppImage/DEB on Linux). All main and preload dependencies are bundled. Runtime backend configuration stays validated by `@quieter/env/desktop`. Packaged applications default to `https://app.quieter.email` and `wss://updates.quieter.email/mail/live`.

The build generates the desktop's squircle icon from the shared brand artwork. Web icons keep their existing shape.

Sender-logo URLs come from the web backend, using its `VITE_LOGO_DEV_PUBLISHABLE_KEY`. Desktop image requests from the main app frame send the configured backend origin as their referrer so domain-restricted image keys work as they do on the website. Private route paths and query parameters are excluded. Missing company or personal logos still use the shared initial fallback.

The desktop build workflow runs only when started manually from GitHub Actions. It produces platform artifacts without publishing a release. Signing, Apple notarization, and release distribution require separate release credentials and authorization. There is no updater endpoint configured. Before distributing a build, deploy the matching server Electron plugin, `/desktop/auth`, and `/api/desktop/session` through the protected web deployment workflow. The Electron plugin uses existing auth tables; no migration is needed.

Packaged error reporting uses the public `VITE_SENTRY_DSN` at build time, supplied by the manual workflow's repository variable. Main-process failures and renderer errors use the shared privacy filters. Local development reporting stays disabled unless `VITE_QUIETER_LOCAL_TELEMETRY=true` is explicitly set.
