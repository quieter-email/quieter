# Actual application provenance verification

Verified November 6, 2026 through the authenticated application at `/settings?tab=ai`, using the supported `vp dev` path, its Cloudflare Worker, real RPC handlers, and a migrated disposable loopback PostgreSQL database. The preview persona and all memory content were synthetic. No API mocks or replacement page were used.

- The learned memory displayed its activity source and support date.
- Editing and saving changed the content and attribution to “Saved by you”. The stored source became explicit, its stale source reference was cleared, and its creation date was preserved.
- Adding a memory displayed the new explicit record.
- The actual actions menu and confirmation dialog deleted that added record. Reloading showed one remaining record with the saved edit and explicit attribution.
- The remaining record stayed readable at 390 by 844 in both light and dark themes.

| State | Screenshot |
| --- | --- |
| Learned source, desktop | [Light desktop](../../screenshots/memory-provenance-app/light-wide.png) |
| Edit dialog | [Before saving](../../screenshots/memory-provenance-app/edit-before-save.png) |
| Manual edit | [Saved](../../screenshots/memory-provenance-app/manual-edit-saved.png) |
| Added memory | [Saved addition](../../screenshots/memory-provenance-app/add-saved.png) |
| Delete persisted after reload | [Light narrow](../../screenshots/memory-provenance-app/light-narrow-after-reload.png) |
| Narrow dark theme | [Dark narrow](../../screenshots/memory-provenance-app/dark-narrow.png) |

The browser session and development server were stopped after verification. The temporary ignored local configuration was removed. This verifies provenance management, not recall quality or end-to-end generated answer quality; those have separate evaluation evidence.
