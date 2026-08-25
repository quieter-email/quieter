# quieter desktop

An experimental native desktop client for quieter, built with [GPUI](https://gpui.rs/). It is intentionally isolated from the TypeScript application: the client speaks the existing HTTP and ORPC contracts directly and keeps its own UI model.

## Run it locally

Start the web app on port 3000, then run the client from this directory:

```powershell
cargo run
```

Debug builds default to `http://localhost:3000`. Release builds default to `https://quieter.email`. Override either with:

```powershell
$env:QUIETER_DESKTOP_URL = "http://localhost:3000"
cargo run
```

On Windows, GPUI's shader build needs `fxc.exe` from the Windows SDK. A standard Windows SDK installation provides it under `Windows Kits\10\bin\<sdk-version>\x64`; add that directory to `PATH` if Cargo cannot find the compiler.

The optional `QUIETER_DESKTOP_TOKEN` environment variable is useful for local API testing. Normal sign-in opens the web app in the system browser, posts the existing session to a one-use loopback callback, and stores the session token in the operating system keychain through GPUI.

## Current scope

- Browser-based quieter auth with a local callback and session reuse.
- Mailbox discovery, default selection, and switching between permitted mailboxes.
- Inbox, unread, archive, sent, drafts, trash, and spam navigation.
- Search, thread loading, archive, trash, mark unread, and refresh.
- Gmail connection handoff to the web app when no mailbox is connected.
- Native compose and send for mailboxes that can send.
- Light/dark palette matching the web app's neutral surfaces and typography.
- A fully interactive local preview mailbox with independent Rust fixtures, so the desktop app is useful before a real Gmail mailbox has been connected.

The browser remains the home for onboarding, Google identity, Gmail authorization, settings, billing, and other flows that are not yet native. The local preview uses the same `demo:mailbox` experience as the web app but owns its data in Rust; live mailboxes use the protected ORPC procedures directly without sharing application code or accessing the database from the desktop client.
