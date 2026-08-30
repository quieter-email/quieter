# Quieter Desktop (experimental)

This is a native GPUI client for Quieter. It does not embed a browser or share web UI code. The only shared boundary is the Quieter server API.

## Run locally

1. Start the web server at `http://localhost:3000`.
2. Run `cargo run --manifest-path apps/desktop/Cargo.toml`.

Debug builds use `http://localhost:3000`. Release builds use `https://quieter.email`. Override either with `QUIETER_SERVER_URL`.

Desktop sessions are authorized in the browser with a short-lived device code and stored in the operating system credential vault.

