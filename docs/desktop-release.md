# Desktop runtime and release evidence

Electron is the selected desktop runtime. Keep one production runtime. Reconsider it only if representative release measurements miss the budgets below after profiling and reasonable tuning.

## Runtime decision

The existing application packages the shared React mail, composer, chat, settings, onboarding, and query persistence from `@quieter/app`. The native process owns encrypted authentication, the authenticated request proxy, operating-system entry points, and notifications. A sandboxed renderer reaches native capabilities through the validated preload bridge. Google identity and mailbox authorization remain separate.

Keeping Electron preserves that delivered architecture and lets desktop users receive the same mail behavior as web users. A second shell would require another authentication, secure-storage, streaming, navigation, and native-integration implementation. No comparative Tauri performance result has been established, so this decision makes no claim that one runtime outperforms the other.

The cost is a bundled Chromium and Node.js runtime, multiple processes, platform-specific packaging, and an ongoing runtime security-update obligation. Measure the whole application process set, including renderer, GPU, and utility processes. The current window disables background throttling, so minimized activity needs its own measurement. Shared renderer or browser evidence does not establish native installation, secure storage, operating-system notifications, or signed-update behavior.

The versions and packaging targets are owned by `apps/desktop/package.json` and `apps/desktop/electron-builder.yml`. The manual `Desktop build` workflow produces artifacts with publication disabled and signing discovery disabled. It is a candidate-building workflow, not a public release channel.

## Initial performance budgets

These are initial engineering release gates. They are not measured results or a completed supported-platform acceptance. QUIETER-148 records the accepted budgets with its representative mailbox and platform matrix before public release.

| Measurement | Initial budget | Required condition |
| --- | --- | --- |
| Each compressed installer | 200 MiB | Measure the actual NSIS, DMG, ZIP, AppImage, or DEB file, excluding the GitHub artifact archive. |
| Installed application files | 600 MiB | Measure the installed application on the target OS. Report unpacked package bytes separately. |
| Cold startup | 5 seconds | First launch after reboot, timed from process launch until the intended screen is usable. |
| Warm startup | 2 seconds | Repeat launch with the same profile and warm OS file cache, to the same usable screen. |
| Settled resident memory | 350 MiB | Sample all app processes after a 60-second settling interval with a representative inbox open. |
| Working resident memory | 600 MiB | Record the peak during inbox, search, compose, and chat navigation with the recorded mailbox size. |
| Minimized CPU | 1% of one logical CPU | Average over five minutes after settling. Record per-process CPU and core count. |
| Minimized network transfer | 100 KiB per minute | Five-minute interval with no new mail, upload, download, or user action. Include the live connection and main-process proxy. |

One MiB is 1,048,576 bytes. Sum resident working sets with an explicit shared-page double-counting caveat. Record Windows private bytes separately when available. A machine under unrelated load cannot establish a release pass without accounting for that interference.

## Evidence classes

| Evidence | What it establishes | What remains open |
| --- | --- | --- |
| Installer size report | Exact file bytes and hashes for a recorded source revision. | Installation, startup, runtime resources, signing, and update delivery. |
| Unpacked package size | Logical regular-file bytes before installation. Symlink targets are not counted twice. | Target filesystem allocation, installer overhead, user data, caches, and actual installed size. |
| Packaged executable run | Behavior of that exact packaged executable under the recorded OS and fixture conditions. | Installer execution, OS registration, real authentication, and real provider effects unless separately exercised. |
| Shared renderer check | Shared UI behavior for the documented transport fixture. | Native lifecycle, installation, signing, authentication, and provider acceptance. |
| Native installation and update | The specific OS, artifact, signature, update path, and recovery cases exercised. | Any untested OS, architecture, release channel, or mailbox condition. |

Retain the source SHA, package version, artifact SHA-256, OS version, architecture, CPU, RAM, display/GPU conditions, secure-storage backend, fixture size, and backend version with every runtime result. Public evidence contains no mailbox identifiers, email content, session data, private URLs, or raw network payloads.

## Measurement procedure

Build the release candidate with the existing desktop commands in [Electron desktop](desktop.md). Run the size-report command from that same checkout after packaging:

```sh
vp run @quieter/desktop#release:size --revision <full-source-SHA>
```

It writes `apps/desktop/release/release-size.json`. The manual build workflow uploads the report beside the measured installers. The report records checkout changes and rejects a different expected revision. A clean output directory and packaging in that same job establish artifact provenance. A matching revision alone cannot detect an old local artifact. A report from a different revision or a directory containing old artifacts is invalid.

Run native installation and runtime acceptance on each candidate operating system. Use a dedicated synthetic or authorized development account and record whether transport is synthetic, service-backed, or provider-backed. Keep secure storage enabled. A startup error, missing inbox, denied permission, failed request, or authentication screen cannot count as a successful inbox measurement.

For cold startup, reboot the owned test machine and measure at least five reboot launches. For warm startup, reuse the same profile and measure at least five full process restarts. A fresh profile on a warm machine is a fresh-profile result, not an OS-cold result. Report the median and range, plus failures, rather than the fastest run. Separate first paint from a verified usable target screen.

Use Electron's [application metrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics) to sample all application processes. The first CPU sample initializes the interval. Keep subsequent sampling intervals consistent and record process creation times as well as process IDs. Use an independent profiler run to identify the startup or activity limiter. Do not report profiler overhead as an ordinary launch result.

Measure settled, working, and minimized activity separately. Count network bytes for both native requests and renderer traffic. Renderer request counts alone omit the main-process proxy. Save numeric aggregates, error counts, and a redacted method description instead of raw network logs. Verify that the intended inbox/search/compose/chat work actually completed before interpreting its duration or memory use.

Use supported automation such as [Playwright's Electron API](https://playwright.dev/docs/api/class-electron) against the packaged executable where appropriate. Record automation and display overhead. An automated API call to a native handler is useful behavior evidence, but does not prove the operating system registered or dispatched a protocol correctly.

## Release acceptance status

| Platform | Artifact targets | Current release acceptance |
| --- | --- | --- |
| Windows | NSIS | Installation, mailto registration, restoration, notification permission, signing, update, and representative runtime measurements remain open. |
| macOS | DMG and ZIP | Installation, protocol dispatch, window lifecycle, notification permission, signing/notarization, update, and representative runtime measurements remain open. |
| Linux | AppImage and DEB | Candidate artifacts exist. First-release support is deferred until secure storage, desktop integration, installation, and updates have explicit acceptance. |

The previously successful manual build at `20f9c6a5cd320ad81f20e1c5ee742a0e51b424b5` is [artifact evidence](https://github.com/quieter-email/quieter/actions/runs/42314528262). It does not establish measurements or installation acceptance for a newer revision.

QUIETER-143 owns the decision and measurement record. QUIETER-145 owns native lifecycle and links. QUIETER-146 owns new-mail notifications. QUIETER-147 owns protected distribution and update preparation. QUIETER-148 accepts the combined release candidate. Keep their remaining gates open until their actual evidence exists. Publication, production deployment, signing-authority changes, and production resource changes require the protected release authorization.
