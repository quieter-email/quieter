# Quieter Desktop (experimental)

This is a native GPUI client for Quieter. It does not embed a browser or share web UI code. The only shared boundary is the Quieter server API.

## Run locally

1. Install the current stable Rust toolchain and the native prerequisites below.
2. Start the web server at `http://localhost:3000` using the development setup in `docs/development.md`.
3. Run `vp run desktop:dev` from the repository root.

Vite+ runs the native Cargo commands without adding a JavaScript UI or making the Rust workspace depend on web packages. Normal server development uses the allowlisted PlanetScale `quieter_dev` database and development-stage SST Secret bindings. The desktop does not connect to a database; no persistent local PostgreSQL installation is required. The shared fixture verification can also run against a disposable loopback test database.

This pass was built and exercised on Windows. Use the MSVC Rust toolchain, Visual Studio Build Tools with the Desktop development with C++ workload, the Windows SDK, and CMake. Open a Visual Studio Developer PowerShell if the compiler or SDK tools are not found. The [upstream Windows dependency guide](https://github.com/zed-industries/zed/blob/main/docs/src/development/windows.md#dependencies) describes those native tools. Its Zed database setup is not needed by this client. GPUI 0.2.2 release builds also need the SDK's `fxc.exe`, available on `PATH` or through the `GPUI_FXC_PATH` build-tool setting. macOS and Linux builds have not been verified in this pass.

Debug builds use `http://localhost:3000`. Release builds use `https://quieter.email`. Override either with `QUIETER_SERVER_URL`. The app crate is optimized in development too, so the native effects do not incur unoptimized rasterization costs.

Desktop sessions are authorized in the browser with a device code and stored in the operating system credential vault, separately for each server origin. The app polls the server while you sign in and approve the matching code. It never starts a localhost callback listener or redirects the browser back to the desktop. Browser approval ends on the server's confirmation page.

Each sign-in attempt has a five-minute deadline, including the initial code request. A countdown stays visible while approval is pending. Cancel stops the attempt, and timeout shows “Sign-in took too long. Try again.” Polls respect server slowdown responses and retry temporary connection failures within that deadline; late or canceled sessions are revoked instead of saved. Loopback server URLs are only for the local development backend.

Start browser sign-in immediately, only when there is no saved session:

```powershell
vp run desktop:dev -- --connect
```

For isolated browser QA, `--connect --no-open-browser` prints the verification page URL without opening the default browser or activating the desktop after approval. The device code remains visible in the app, and its explicit browser button still works. The private device secret and session token are never printed.

Start the offline visual preview using the web app's demo inbox fixture:

```powershell
vp run desktop:dev -- --preview
```

`QUIETER_DESKTOP_PREVIEW=1` remains supported. `QUIETER_DESKTOP_FORCE_SIGNED_OUT=1` ignores saved credentials for an explicit sign-in test and can be combined with `--connect`. Preview mode never reads, revokes, or removes a saved session. Credentials are stored separately for each server origin. Remote servers require HTTPS; HTTP is accepted only on loopback addresses.

Keyboard shortcuts use Ctrl on Windows/Linux and Cmd on macOS: N opens compose, K focuses search, R refreshes the inbox. Escape closes compose while preserving its draft, or clears the selected conversation. Drafts remain bound to the mailbox they were opened from.

## Verification

```powershell
vp run desktop:check
vp run desktop:test
vp run desktop:build
```

The tests exercise HTTP request contracts, device authorization states, server-origin restrictions, reply recipients and threading headers, and rollback isolation after mailbox changes or sign-out. The local managed-mail fixture blocks delivery outside the local environment; a successful local read or mutation test does not imply that production mail delivery was exercised.

For a shared web/native dataset, follow the local setup in `docs/development.md`, sign in locally, and run `vp run dev:fixtures your-local-login@example.com` with that local account's actual email. The command prints the fixture mailbox URL. Select that real mailbox in both clients, not the web's client-only Demo Mailbox. Fixtures use reserved test addresses and never deliver externally.

## Native rendering

The workspace follows the current web geometry: a 272px sidebar, a list column sized to the larger of 34% or 405px in the two-panel layout, 68px two-line rows, Geist typography, named OKLCH colors, and native panel gradients over the solid canvas. Below 1100px, the list and conversation use one panel with a Back to list control. SVG brand and icon assets are local copies of the web assets. The native title bar is additional desktop chrome.

Refreshing a list preserves the open conversation and its position, including a newly read thread in Unread until it is closed. Conversation cards appear newest first and expand independently, with the latest message initially open. The offline preview includes the three-message onboarding conversation. Invalid timestamps are hidden; numeric server timestamps and dates from previous years are formatted for the list.

The dark sign-in scene renders the web-inspired particle field on a dedicated Rust worker and uploads it as a GPUI texture, capped at 24 frames per second. Work is suspended when inactive; reduced motion keeps a static frame. This is native texture compositing rather than the web's GPU shader pipeline. Windows acrylic is enabled, while the workspace canvas and panel gradients remain opaque to preserve the web colors.

Hover transitions use the web's 160ms easing, and view/composer entrances use its 280ms easing. The Help menu provides light/dark appearance and reduced motion. Inbox rendering is virtualized; network requests run off the UI thread.

## Experimental boundaries

Reading, searching, switching mailboxes, labels, composing plain-text mail, threaded replies, and core conversation actions use the real server. Chat and settings open in the browser. Full HTML-email layout, attachment controls, rich-text composition, saved-view management, notifications, offline storage, and production packaging are not implemented. Drafts are retained only while this process runs.

Production needs the server changes in this branch and the additive `deviceCode` database migration before desktop authorization can work. Do not apply that migration through local development commands. No production deployment is part of this experiment.
