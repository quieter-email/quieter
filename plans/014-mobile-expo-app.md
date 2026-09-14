# QUIETER-97 — Expo mobile app (foundation for 138 / 139 / 141 / 142)

Build a first-party native client for iOS and Android that reuses the web app's design tokens,
data contracts, and business logic. The responsive web mail experience stays the interaction
baseline (`docs/responsive-mail.md`); the native shell delivers the same mailbox-scoped
navigation, search state, selection semantics, thread reading, and message actions.

## Goals

1. `apps/mobile`: an Expo (SDK 57) app with Expo Router, Uniwind (Tailwind v4 for React Native),
   TanStack Query, and Better Auth's Expo integration.
2. `packages/query`: a provider-neutral package that owns TanStack Query option factories built on
   `@quieter/orpc`, consumable by the web app, the mobile app, and a future desktop app.
3. One design language: the mobile theme consumes the same CSS custom properties as
   `packages/ui/src/styles.css`, so colors, radius, type scale, and elevation stay identical.
4. Shared session: identity sign-in happens in a browser session that deep-links back into the app;
   the Better Auth session cookie is persisted in `expo-secure-store` and attached to every oRPC
   request. Gmail authorization stays separate and web-driven.
5. Local development: a dedicated Android emulator AVD runs the app against the local web server
   (`http://10.0.2.2:3000`) with Metro fast refresh.

## Non-goals (this series)

- App Store / Play Store release pipelines and EAS credentials.
- Native push notifications, widgets, share extensions, and offline mail caching.
- Re-implementing the TipTap composer; compose ships as a native text composer with the same
  draft contract first.
- Chat assistant, onboarding, and billing surfaces beyond what the shell needs.

## Architecture

```
apps/mobile (Expo Router)
├── app/                routes: (auth)/sign-in, (app)/..., message detail, compose
├── src/
│   ├── components/     native UI primitives (Uniwind classNames, @quieter/ui tokens)
│   ├── features/       mailbox, message-list, message-thread, compose, navigation, settings
│   ├── lib/            auth client, orpc client, query client, theme
│   └── global.css      tailwind + uniwind + shared tokens
packages/query          query/mutation option factories + keys (shared with web)
packages/orpc           existing client/server contracts
packages/auth           existing Better Auth server; adds the expo() server plugin
```

### Shared queries

`packages/query` exports `createQueryApi(client)` returning namespaced
`queryOptions()`, `mutationOptions()`, keys, and invalidation helpers for the mail, mailbox,
labels, templates, chats, AI, and onboarding procedures. Every key includes `mailboxId` where the
procedure is mailbox-scoped, matching `AGENTS.md`. The web app can migrate call sites
incrementally; new mobile code consumes the package immediately.

### Auth

- Server: add `expo()` from `@better-auth/expo` to `packages/auth` and trust the `quieter://`
  scheme plus Expo development origins.
- Client: `better-auth/react` + `expoClient({ scheme: "quieter", storage: SecureStore })`.
- Native requests: `authClient.getCookie()` → `Cookie` header on the oRPC fetch transport.
  No bearer plugin is added; the cookie session remains the single source of truth.

### Styling

`packages/ui/src/theme.css` owns the token blocks (`:root` / `.dark` variables plus `@theme
inline`). `packages/ui/src/styles.css` and `apps/mobile/src/global.css` both import it. Uniwind
compiles the same `bg-bg-raised`, `text-muted-fg`, `border-border`, `rounded-xl` classes used on
the web.

## Local development

1. Copy `.env.local` / `.env.sst.local` from the main checkout.
2. `vp run dev` for the web server on port 3000.
3. `vp run @quieter/mobile#android` builds the dev client once, then Metro serves fast refresh.
4. The emulator reaches the host through `10.0.2.2`; the app reads `EXPO_PUBLIC_QUIETER_API_URL`.

## Phases

| # | Phase | Deliverable |
| - | ----- | ----------- |
| 1 | Foundation | `apps/mobile` scaffold, Uniwind theme, Android emulator, draft PR |
| 2 | Auth | Expo plugin on the server, sign-in screen, session persistence, deep-link return |
| 3 | Shell | Drawer navigation (mailboxes, labels, settings), message list with search and filters |
| 4 | Reading | Thread view with read state, labels, reply/forward entry points |
| 5 | Compose | Native composer, draft autosave, send |
| 6 | Shared queries | `packages/query` extraction and web migration for the highest-traffic queries |
| 7 | Verification | Boundary checks, mobile typecheck, emulator walkthrough, docs |

## Verification

- `vp run check:boundaries` stays green (mobile may consume packages, never the reverse).
- `vp check` on changed workspaces.
- Manual emulator walkthrough: sign-in → inbox → search → thread → label/archive → compose → send.
- Hot reload: edit a component and confirm fast refresh without a native rebuild.
