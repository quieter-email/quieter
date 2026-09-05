# Quieter brand assets

The final symbol is original 004, with its wider rounded bottom. The wordmark uses outlined Geist Regular with a curved q descender, a rotated 004 dot on the i, and adjusted spacing. No font installation is needed to use the SVGs.

The primary colors are `#0e0f10` and `#eeeef0`.

- `core/`: SVG and PNG masters for the icon, wordmark and combination. Each has dark and light ink, both transparent and on a contrasting solid background. In these filenames, dark and light describe the **ink**.
- `01-obsidian/` through `12-eclipse/`: 108 social PNGs. Each treatment includes all three artwork variants at 1024 × 1024 for profiles, 1200 × 630 for OG images, and 2400 × 800 for banners. Profile artwork fits inside a circular crop.
- `contact-sheet.png`: overview of the 12 treatments.
- `index.html`: local gallery with links to every full-size social PNG.
- `manifest.json`: filenames and dimensions for all social assets.
- The six original root filenames now point to exports of the final design.

The canonical vector geometry is `packages/ui/src/lib/brand-geometry.ts`. Shared React artwork, the auth particle mask, and loading animation consume it directly. To regenerate this pack and the production assets in `apps/web/public`, run `vp run generate:assets` from the repository root. The generator needs the existing project dependencies and no external image service. Only the contact-sheet captions use a system font.

The app uses the atmosphere combination as its OG image. Its favicons use the solid mark, with a warm tint for the development favicon. The web manifest retains its mailto handler. Old Illustrator files and rejected explorations have been removed.
