# AGENTS.md

## Project Overview

Markdown Preview Plus is a read-only, single-document desktop Markdown reader. It opens `.md`/`.markdown` files, renders GFM locally, supports Mermaid and PlantUML diagrams, and provides search, a table of contents, and print-to-PDF. The app starts empty; `fixtures/reader-demo.md` is a manual reference document, not startup content.

## Tech Stack

- Tauri 2 Rust host with Vite and vanilla TypeScript/CSS frontend.
- `marked` 18 is the Markdown parser; DOMPurify sanitizes generated HTML.
- Mermaid and official `@plantuml/core` render diagrams only after safe placeholders are inserted.
- Phase 2 uses local KaTeX 0.18.9, `marked-katex-extension`, js-yaml, and highlight.js core with curated languages.
- npm is the frontend package manager. `src-tauri/` contains native configuration and Rust sources.

## Architecture

- `src/main.ts` owns window state, document loading, images, search, TOC, and print flow. Keep toolbar/title behavior here; front matter does not override the filename title in Phase 2.
- `src/markdown.ts` owns URL/image policy, heading IDs, front matter extraction, Marked extensions, code highlighting, and final DOMPurify sanitization. `renderMarkdown` remains a string API; `renderMarkdownDocument` returns `{ html, metadata, frontMatterError }`.
- Mermaid/PlantUML fences render as `.diagram-placeholder` elements in `src/markdown.ts`; `src/diagrams.ts` replaces them asynchronously and sanitizes returned SVG.
- `src/styles.css` contains the existing light/dark theme tokens and article layout. `src/katex/katex.css` is a filtered KaTeX stylesheet; `src/katex/fonts/` contains only the referenced `.woff2` assets.
- `src-tauri/src/` enforces native file-read, path, image, single-instance, and print integration policies. Do not grant Markdown arbitrary filesystem or IPC access.

## Important Directories

- `src/`: frontend implementation.
- `tests/`: Vitest tests, currently focused on URL/security, rich-content parsing, and read-queue behavior.
- `fixtures/`: manual Markdown examples and local raster fixture.
- `public/plantuml/`: bundled PlantUML runtime assets.
- `src-tauri/`: Tauri/Rust host, capabilities, icons, and build configuration.
- `dist/` and `src-tauri/target/`: generated output; do not edit by hand.

## Commands

```sh
npm ci
npm run dev
npm run tauri:dev
npm run check
npm test
npm run build
npm audit --omit=dev
npm run tauri:build
```

The native build requires the target OS's Rust/Tauri prerequisites. Windows verification may use the repository's isolated toolchain under `.tools/`; Linux and macOS builds require their own runners. A local copy may not include Git metadata, so verify `git status` and the configured remotes before assuming Git workflows are available.

## Development Workflow

Make the smallest change that satisfies the behavior and preserve the Marked renderer. Keep Mermaid/PlantUML interception before highlighting. Test malformed content as a local failure: following Markdown must still render. Update README/PLAN/VERIFICATION whenever supported syntax, dependencies, security policy, or validation evidence changes. Never add CDN, remote font/theme/grammar, PlantUML server, telemetry, or toolbar/settings scope without an explicit product decision.

## Testing And Verification

At minimum run `npm run check`, `npm test`, `npm run build`, and `npm audit --omit=dev` after frontend changes. Use `fixtures/reader-demo.md` for manual/browser smoke: front matter stays out of the body, math is visible, all four admonitions and unknown fallback render, curated fences highlight, unknown fences remain escaped, diagrams still become placeholders, and following content survives invalid YAML/math. Verify network logs remain empty for rendering. Native build/runtime and installer sizes must be reported as passed, failed, or not run; never infer them from frontend success.

## Coding Conventions

Use strict TypeScript and existing vanilla DOM patterns. Keep generated HTML escaped/sanitized, use narrow URL/path checks, and use theme variables instead of a new palette. Keep article code at 13px with horizontal scrolling. Prefer focused tests and avoid unrelated refactors or broad allowlist changes.

## Configuration And Environment

There are no required application secrets or environment variables. Vite uses `base: './'` for offline Tauri assets. Tauri capabilities and the Rust host are security boundaries; inspect them before changing file or window permissions. KaTeX CSS/fonts and highlight grammars must remain bundled locally.

## Notes For Future Codex Sessions

- Use `npm install --save-exact` for dependency changes and record registry release/deprecation/license evidence in PLAN/README.
- Front matter syntax is a complete leading block only; malformed YAML is stripped with a visible local warning and empty metadata, while an unmatched opener remains ordinary Markdown.
- Supported admonition names are exactly `note`, `tip`, `warning`, and `danger`; unknown names must remain visible.
- Highlight aliases are bash/shell/sh, javascript/js, typescript/ts, markdown/md, python/py, rust/rs, yaml/yml, and xml/html, plus canonical CSS and JSON.
- KaTeX runs with `throwOnError: false`, `trust: false`, strict mode, and bounded expansion/size. Do not allow raw HTML or user-controlled KaTeX HTML extensions.

## Documentation Freshness

README.md documents user-facing syntax and dependency evidence. PLAN.md is the product/architecture source of truth. VERIFICATION.md records commands, browser/native checks, and artifact measurements actually run. Refresh all three when behavior or validation changes; label unverified platform work and size deltas explicitly.
