# Quieter Desktop (experimental)

This is a native GPUI client for Quieter. It does not embed a browser or share web UI code. The only shared boundary is the Quieter server API.

## Run locally

1. Start the web server at `http://localhost:3000`.
2. Run `cargo run --manifest-path apps/desktop/Cargo.toml`.

Debug builds use `http://localhost:3000`. Release builds use `https://quieter.email`. Override either with `QUIETER_SERVER_URL`. The app crate is optimized in development too, so the native effects do not incur unoptimized rasterization costs.

Desktop sessions are authorized in the browser with a short-lived device code and stored in the operating system credential vault.

Start browser sign-in immediately, only when there is no saved session:

```powershell
cargo run --manifest-path apps/desktop/Cargo.toml -- --connect
```

For isolated browser QA, `--connect --no-open-browser` prints the verification page URL without opening the default browser or activating the desktop after approval. The device code remains visible in the app, and its explicit browser button still works. The private device secret and session token are never printed.

Start the offline visual preview using the web app's demo inbox fixture:

```powershell
cargo run --manifest-path apps/desktop/Cargo.toml -- --preview
```

`QUIETER_DESKTOP_PREVIEW=1` remains supported. `QUIETER_DESKTOP_FORCE_SIGNED_OUT=1` ignores saved credentials for an explicit sign-in test and can be combined with `--connect`. Preview mode never reads, revokes, or removes a saved session. Credentials are stored separately for each server origin. Remote servers require HTTPS; HTTP is accepted only on loopback addresses.

Keyboard shortcuts use Ctrl on Windows/Linux and Cmd on macOS: N opens compose, K focuses search, R refreshes the inbox. Escape closes compose while preserving its draft, or clears the selected conversation. Drafts remain bound to the mailbox they were opened from.

## Verification

```powershell
cargo check --manifest-path apps/desktop/Cargo.toml
cargo test --manifest-path apps/desktop/Cargo.toml
```

The tests exercise HTTP request contracts, device authorization states, server-origin restrictions, reply recipients and threading headers, and rollback isolation after mailbox changes or sign-out. The local managed-mail fixture blocks delivery outside the local environment; a successful local read or mutation test does not imply that production mail delivery was exercised.

For a shared web/native dataset, follow the local setup in `docs/development.md`, sign in locally, and run `vp run dev:fixtures your-local-login@example.com` with that local account's actual email. The command prints the fixture mailbox URL. Select that real mailbox in both clients, not the web's client-only Demo Mailbox. Fixtures use reserved test addresses and never deliver externally.

## Native rendering

The workspace reproduces the current web geometry: 272px sidebar, 34% list column, 68px two-line rows, Geist typography, named OKLCH colors, and raised panels at 60% opacity over the dither field. SVG brand and icon assets are local copies of the web assets. The native title bar is additional desktop chrome.

The workspace dither is rasterized once per size/theme/scale and cached. The sign-in atmosphere ports the web's field math and particle physics to Rust, rendered on a dedicated worker and uploaded as GPUI textures. The atmosphere uses at most 20,000 samples per frame with full-resolution particles, capped at 24 frames per second. Work is suspended when inactive; reduced motion keeps a static frame. This is not a WebView and does not run JavaScript. GPUI 0.2.2 on Windows does not expose a public custom-fragment-shader or backdrop-filter API, so this is native texture compositing, not the same GPU shader pipeline or browser blur implementation. Windows acrylic is enabled, but the workspace base remains opaque to preserve the web colors; panel translucency reveals the internal dither.

Hover transitions use the web's 160ms easing, and view/composer entrances use its 280ms easing. The Help menu provides light/dark appearance and reduced motion. Inbox rendering is virtualized; network requests run off the UI thread.

## Experimental boundaries

Reading, searching, switching mailboxes, labels, composing plain-text mail, threaded replies, and core conversation actions use the real server. Chat and settings open in the browser. Full HTML-email layout, attachment controls, rich-text composition, saved-view management, notifications, offline storage, and production packaging are not implemented. Drafts are retained only while this process runs.

Production needs the server changes in this branch and the additive `deviceCode` database migration before desktop authorization can work. Do not apply that migration through local development commands. No production deployment is part of this experiment.
