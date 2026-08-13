import ultraciteFmt from "ultracite/oxfmt";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";
import { configDefaults, defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ...ultraciteFmt,
    ignorePatterns: [
      ...(ultraciteFmt.ignorePatterns ?? []),
      ".agents/**",
      ".scratch/**",
      "**/.sst/**",
      "sst-env.d.ts",
      "routeTree.gen.ts",
      "plans/**",
    ],
    sortTailwindcss: {
      functions: ["clsx", "cn", "twMerge"],
      stylesheet: "packages/ui/src/styles.css",
    },
  },
  lint: {
    extends: [core, react, tanstack, vitest],
    ignorePatterns: [
      ...(core.ignorePatterns ?? []),
      ".agents/**",
      ".scratch/**",
      "**/.sst/**",
      "sst-env.d.ts",
      "routeTree.gen.ts",
      "sst.config.ts",
      "vite.config.ts",
    ],
    jsPlugins: [
      { name: "react-doctor", specifier: "oxlint-plugin-react-doctor" },
      { name: "sonarjs", specifier: "eslint-plugin-sonarjs" },
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["apps/web/src/router.tsx", "apps/web/src/types/posthog.d.ts"],
        rules: {
          // These declarations augment existing module/global types and must merge.
          "typescript/consistent-type-definitions": "off",
        },
      },
      {
        files: [
          "apps/**/src/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "packages/**/src/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
        ],
        rules: {
          "node/no-sync": "error",
        },
      },
      {
        files: [
          "apps/web/src/routes/api/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "packages/mail/src/**/*.ts",
          "packages/orpc/src/client.ts",
          "packages/orpc/src/context.ts",
          "packages/orpc/src/routers/**/*.ts",
          "packages/orpc/src/server-client.ts",
          "packages/orpc/src/server.ts",
        ],
        rules: {
          "typescript/explicit-module-boundary-types": "error",
        },
      },
      {
        files: [
          "apps/web/src/env.ts",
          "apps/web/vite.config.ts",
          "packages/aws/scripts/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "packages/billing/scripts/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "packages/database/scripts/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "packages/env/scripts/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "scripts/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "sst.config.ts",
        ],
        rules: {
          "node/no-process-env": "off",
        },
      },
      {
        files: [
          "apps/**/src/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
          "packages/**/src/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
        ],
        rules: {
          "node/no-process-env": "error",
        },
      },
      {
        files: ["packages/env/src/**"],
        rules: {
          "node/no-process-env": "off",
        },
      },
      {
        files: [
          "apps/web/src/features/mailbox/components/mailbox-workspace/use-mailbox-messages.ts",
          "apps/web/src/lib/gmail/use-gmail-live-sync.ts",
          "packages/env/src/local-doctor.ts",
        ],
        rules: {
          "node/no-sync": "off",
        },
      },
      {
        files: [
          "apps/web/src/features/message-thread/domain/mail-html.test.ts",
          "apps/web/src/lib/site-password.server.ts",
          "packages/env/src/github.ts",
          "packages/mail/tests/message-content.test.ts",
        ],
        rules: {
          "sonarjs/no-hardcoded-passwords": "off",
        },
      },
      {
        files: [
          "apps/web/src/routes/auth.tsx",
          "apps/web/src/routes/settings.tsx",
          "apps/web/src/routes/site-password.tsx",
        ],
        rules: {
          // Zod's schema fallback method is named catch(), but it is not a promise chain.
          "promise/prefer-await-to-then": "off",
        },
      },
      {
        // TanStack route modules intentionally declare the route before the
        // component and helper implementations they reference.
        files: ["apps/web/src/routes/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
        rules: {
          "eslint/func-style": "off",
          "eslint/no-use-before-define": "off",
          "react/function-component-definition": "off",
          "typescript/only-throw-error": "off",
        },
      },
      {
        // These modules contain intentionally ordered hook/cache closures and
        // request bootstrap helpers whose declarations are kept with their
        // consuming flow.
        files: [
          "apps/web/src/features/message-search/components/message-list-search/use-message-list-search-controller.ts",
          "apps/web/src/features/settings/components/settings-overview-panel.tsx",
          "apps/web/src/lib/gmail/inbox-query/actions.ts",
          "apps/web/src/lib/gmail/inbox-query/data.ts",
          "apps/web/src/lib/gmail/use-gmail-live-sync.ts",
          "apps/web/src/start.ts",
        ],
        rules: {
          "eslint/no-use-before-define": "off",
          "node/callback-return": "off",
        },
      },
      {
        // These effects own imperative canvas/DOM lifecycles. Their cleanup
        // branches intentionally return a disposer while setup can stop early.
        files: [
          "apps/web/src/components/atmospheric-background.tsx",
          "apps/web/src/components/auth-visual.tsx",
          "apps/web/src/components/contour-lines.tsx",
          "apps/web/src/components/workspace-dither-background.tsx",
          "apps/web/src/features/chat/components/chat-transcript.tsx",
          "apps/web/src/features/message-thread/components/message-body.tsx",
          "apps/web/src/features/message-thread/components/message-view.tsx",
          "apps/web/src/features/navigation/components/sidebar-label-nav.tsx",
          "apps/web/src/lib/gmail/use-gmail-live-sync.ts",
        ],
        rules: {
          "typescript/consistent-return": "off",
          "unicorn/no-useless-undefined": "off",
        },
      },
      {
        // React Compiler cannot model these imperative refs and animation
        // lifecycles, which are deliberately kept outside render semantics.
        files: [
          "apps/web/src/components/atmospheric-background.tsx",
          "apps/web/src/components/workspace-dither-background.tsx",
          "apps/web/src/features/chat/components/chat-transcript.tsx",
          "apps/web/src/features/compose/components/compose-workspace.tsx",
          "apps/web/src/features/navigation/components/mailbox-switcher.tsx",
          "apps/web/src/features/navigation/components/sidebar-surfaces.tsx",
          "apps/web/src/features/mailbox/components/mailbox-workspace.tsx",
        ],
        rules: {
          "react/react-compiler": "off",
        },
      },
      {
        // React 19's ReactNode includes promise-capable render children; this
        // map callback renders them and does not perform asynchronous work.
        files: [
          "apps/web/src/features/navigation/components/mailbox-switcher.tsx",
        ],
        rules: {
          "typescript/promise-function-async": "off",
        },
      },
      {
        // This validator intentionally uses explicit undefined returns for
        // invalid input, matching its string-or-undefined contract.
        files: ["apps/web/src/lib/return-to.ts"],
        rules: {
          "unicorn/no-useless-undefined": "off",
        },
      },
      {
        // These containers only delegate pointer-hover cleanup or keyboard
        // navigation to their child controls; they are not themselves actions.
        files: [
          "apps/web/src/features/navigation/components/sidebar-workspace-view-switch.tsx",
          "apps/web/src/features/navigation/components/sidebar-mailbox-nav.tsx",
          "apps/web/src/features/navigation/components/mail-sidebar.tsx",
        ],
        rules: {
          "jsx-a11y/no-noninteractive-element-interactions": "off",
        },
      },
      {
        // The mailbox switcher delegates arrow-key navigation from its scroll
        // container to mailbox buttons and its hover rows own pointer state.
        files: [
          "apps/web/src/features/navigation/components/mailbox-switcher.tsx",
        ],
        rules: {
          "eslint/class-methods-use-this": "off",
          "jsx-a11y/no-noninteractive-element-interactions": "off",
          "jsx-a11y/no-static-element-interactions": "off",
          // This handler stays beside the dropdown's keyboard behavior while
          // depending only on the delegated DOM event itself.
          "unicorn/consistent-function-scoping": "off",
        },
      },
      {
        // These are required browser/domain boundary implementations: the
        // terms cookie predates Cookie Store support, and the test fixture
        // verifies javascript URLs are rejected by the mail parser.
        files: [
          "apps/web/src/lib/terms-acceptance.ts",
          "apps/web/src/features/message-thread/domain/mail-html.test.ts",
        ],
        rules: {
          "eslint/no-script-url": "off",
          "unicorn/no-document-cookie": "off",
        },
      },
      {
        // This promise is an abortable browser timer used to pace reconnects;
        // wrapping the timer is the behavior under test, not a new data flow.
        files: ["apps/web/src/features/chat/hooks/use-chat-run-stream.ts"],
        rules: {
          "promise/avoid-new": "off",
        },
      },
      {
        // React.Children.toArray intentionally normalizes opaque children for
        // the slot signature before the transition state is reconciled.
        files: ["apps/web/src/components/vertical-slot.tsx"],
        rules: {
          "react/no-react-children": "off",
        },
      },
      {
        // These components intentionally create the dynamic Motion element
        // at render time because `as` is a caller-selected element type.
        files: [
          "apps/web/src/features/home/components/reveal.tsx",
          "apps/web/src/features/message-search/components/message-list-search/use-message-list-search-controller.ts",
        ],
        rules: {
          "react/react-compiler": "off",
        },
      },
      {
        // The token field is an ARIA combobox over a contenteditable region
        // with an aria-activedescendant listbox. Neither select nor datalist
        // can express inline tokens, so the roles must stay explicit.
        files: ["packages/ui/src/components/ui/token-field.tsx"],
        rules: {
          "jsx-a11y/prefer-tag-over-role": "off",
        },
      },
      {
        // The shared Input is associated through htmlFor/aria-labelledby, but
        // this rule cannot resolve that relationship through the wrapper.
        files: [
          "apps/web/src/features/compose/components/template-workspace.tsx",
        ],
        rules: {
          "jsx-a11y/control-has-associated-label": "off",
        },
      },
      {
        // These APIs are callback-based by design: browser subscriptions and
        // Sentry's scope/configuration hooks do not expose awaitable variants.
        files: [
          "apps/web/src/lib/preview-personas.ts",
          "apps/web/src/lib/server-error-reporting.ts",
          "apps/web/src/features/ai/domain/default-chat-model-setting.ts",
          "packages/aws/src/sentry.ts",
          "packages/cloudflare/src/worker-utils.ts",
        ],
        rules: {
          "node/callback-return": "off",
          "promise/prefer-await-to-callbacks": "off",
        },
      },
      {
        // These loops preserve ordering or bounded concurrency across remote
        // mail operations; parallelizing them would change mailbox semantics.
        files: [
          "apps/web/scripts/check-worker-memory-boundaries.ts",
          "packages/orpc/src/ai-memory.ts",
          "packages/orpc/src/gmail-sync/service.ts",
          "packages/orpc/src/mailbox-actions/executor.ts",
          "packages/orpc/src/managed-mail/rules/service.ts",
          "packages/orpc/src/organization-api-mail.ts",
        ],
        rules: {
          "eslint/no-await-in-loop": "off",
        },
      },
      {
        // Request-body streams must be consumed and cancelled in order.
        files: ["apps/web/src/routes/api/v1/send.ts"],
        rules: {
          "eslint/no-await-in-loop": "off",
        },
      },
      {
        // These cache/query helpers intentionally return undefined for a
        // missing result or JSON-replacer omission.
        files: [
          "apps/web/src/lib/query-persister.ts",
          "apps/web/src/lib/gmail/inbox-query/data.ts",
          "apps/web/src/lib/gmail/inbox-query/query-cache.ts",
        ],
        rules: {
          "unicorn/no-useless-undefined": "off",
        },
      },
      {
        // TanStack's persister bridge still requires the deprecated direction
        // field in its query context type while page params are adapted.
        files: ["apps/web/src/lib/gmail/inbox-query/sync.ts"],
        rules: {
          "typescript/no-deprecated": "off",
        },
      },
      {
        // React 19 permits promise-capable ReactNode children, but these are
        // synchronous client components and must not become async components.
        files: [
          "apps/web/src/components/telemetry-provider.tsx",
          "apps/web/src/features/home/components/home-smooth-scroll.tsx",
          "apps/web/src/features/message-thread/components/message-actions.tsx",
        ],
        rules: {
          "typescript/promise-function-async": "off",
        },
      },
      {
        // Base UI menu items intentionally expose onSelect; this file also
        // passes the domain label-update callback through a dialog boundary.
        files: [
          "apps/web/src/features/message-thread/components/message-actions.tsx",
        ],
        rules: {
          "react/jsx-handler-names": "off",
        },
      },
    ],
    rules: {
      "import/no-commonjs": "error",
      "jsx-a11y/no-autofocus": "error",
      "no-console": "error",
      "typescript/consistent-type-definitions": ["error", "type"],
      // Fire-and-forget event handlers need an explicit promise boundary.
      "no-void": "off",
      "react-doctor/no-secrets-in-client-code": "error",
      "react-doctor/query-mutation-missing-invalidation": "error",
      "react-doctor/query-no-query-in-effect": "error",
      "react-doctor/query-stable-query-client": "error",
      "react-doctor/tanstack-start-loader-parallel-fetch": "error",
      "react-doctor/tanstack-start-no-secrets-in-loader": "error",
      "react-doctor/tanstack-start-server-fn-validate-input": "error",
      "react/no-array-index-key": "error",
      "react/no-unknown-property": "error",
      "sonarjs/no-clear-text-protocols": "error",
      "sonarjs/no-hardcoded-passwords": "error",
      "sonarjs/no-hardcoded-secrets": "error",
      "sonarjs/no-ignored-exceptions": "error",
      "unicorn/prefer-ternary": "off",
      "unicorn/no-process-exit": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
      "vitest/no-conditional-in-test": "error",
    },
  },
  staged: {
    "*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,json,jsonc,css,md,mdx}": "vp check --fix",
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".scratch/**",
      "packages/cloudflare/tests/**",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
});
