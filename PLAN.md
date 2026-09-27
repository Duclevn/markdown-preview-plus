# Markdown Preview Plus — product and implementation plan

## Scope
Read-only, single-document desktop Markdown reader. Primary outcome: double-click a Markdown file and read formatted content including Mermaid and PlantUML diagrams. The three document actions are Open File, Search in file, and Export to PDF, with a separate table-of-contents view toggle. No editor, write-back, workspace, tabs, account, sync, telemetry, or background daemon.

## Architecture decision
Tauri 2 (Rust host) + Vite + vanilla TypeScript/CSS. Use the OS WebView, not a bundled browser. Markdown parser + sanitizer, lazy Mermaid, lazy official @plantuml/core. Bundle runtime assets for offline operation. Build Windows NSIS .exe, Linux .deb, macOS .app/.dmg on their corresponding OS runners. File association registration must not forcibly change the user's default application.

References checked 2026-09-26:
- https://v2.tauri.app/start/
- https://v2.tauri.app/distribute/
- https://github.com/plantuml/plantuml.js and its API.md: older integration uses CheerpJ initialization.
- https://www.npmjs.com/package/@plantuml/core : official TeaVM JavaScript engine; verify exact pinned version/API, local Graphviz script, redistribution license and runtime integration. Do not assume compatibility with every Java PlantUML feature.

## Complete interface specification
- Native OS title bar, initial 1040 x 780 window, minimum 640 x 480.
- 56px sticky toolbar: document icon and ellipsized filename left (path tooltip); Open File in blue, Search in purple, neutral Contents toggle, and Export PDF in red right. Buttons have icons AND labels, native keyboard focus, and accessible names. At narrow widths toolbar wraps without hiding actions.
- Reading area uses 16–32px viewport gutters and a centered article capped at 1160px, with 46px top and 32px horizontal article padding; body 16px system font, line-height 1.7. H1 32px, H2 24px. Monospace code 13px; tables and code scroll horizontally within the article.
- Quiet warm neutral canvas, white/light or charcoal/dark reading surface, teal accent. Honor OS appearance without adding a settings screen. Links visibly distinguishable; text contrast at least 4.5:1.
- Empty state: small document illustration, 'Your Markdown, beautifully readable.', one primary Open File button, 'Or drop a .md file here', Ctrl/Cmd+O hint. Search and Export disabled until loaded. No demo document automatically loaded.
- Reading state: clean article with a persistent 190–220px left table-of-contents sidebar for documents containing H1–H6 headings. It opens expanded by default; the toolbar Contents toggle collapses/expands it, retaining that state in runtime memory across document loads only. Empty or no-heading documents hide both the sidebar and toggle. Sidebar entries are real anchors with smooth scrolling, and an IntersectionObserver rooted at the reading area marks the active heading link. Mermaid/PlantUML blocks become diagrams with a subtle language caption, intrinsic readable sizing and contained horizontal overflow. Loading state reserves space and says 'Rendering diagram…'. A failure is local to its diagram with clear message and original source in a disclosure.
- Search: a floating, sticky pill below the toolbar and aligned to the article's upper-right content edge; it contains a search icon, compact "Find in file" input, current/total match count, divider, previous/next, and close controls. It does not consume document flow; while open, the reading viewport starts below the pill's band so document text cannot pass behind it. Ctrl/Cmd+F focuses it; Enter/Shift+Enter navigates; Escape closes and restores focus to the article. Highlight visible document text without corrupting markup or SVG. Clarify diagram text coverage in README if excluded.
- Export PDF: waits for all diagrams and local images; show progress and actionable error. Output includes article only, readable margins, no toolbar/search highlights. The toolbar action uses a red accent while retaining its icon, label, and print behavior. Prefer native print-to-PDF / system print dialog with Save as PDF; document per-platform limitations honestly, never claim a PDF file was saved just because a dialog opened.
- Errors: unreadable/unsupported file stays within a compact alert; retain current document when opening a replacement fails. Empty Markdown file has an explicit empty-document state.
- Keyboard: Ctrl/Cmd+O open, Ctrl/Cmd+F search, Ctrl/Cmd+P export; normal select/copy permitted, document never editable. File drop opens one document.

## Dependency maintenance gate
User requires actively maintained libraries. Check upstream discontinuation notices, actual release history and deprecation metadata, not only repository push dates or stars. On 2026-09-26 the old https://github.com/plantuml/plantuml-core README explicitly says its CheerpJ approach is discontinued; https://github.com/plantuml/plantuml.js was last pushed in 2023. Neither is our renderer dependency. The distinct npm package @plantuml/core points to active https://github.com/plantuml/plantuml; its official PUBLISHING_NPM.md documents the TeaVM build. npm registry reports releases 1.2026.5 (May 22), .6 (June 8), .7 (August 25), .8 (September 6), with no deprecated field. Pin the validated version and record this evidence in dependency documentation. Recent maintenance is evidence, not a guarantee of future support. Apply the same check to Mermaid, Tauri, parser and sanitizer before finalizing dependencies.

## Rendering and security requirements
Show Markdown text before starting diagram engines. Import engines only when needed, render sequentially with stale-document cancellation and bounded per-document caches. No CDN, PlantUML server or remote include requests. Disable arbitrary HTML/script execution, dangerous URL schemes and diagram callbacks. Mermaid strict security. Sanitize generated SVG. Permit local relative images only through narrowly scoped native read handling; do not grant the document arbitrary filesystem or IPC access. External links require explicit user navigation through the OS browser.

## Phase 2 — rich content extensions
The existing Marked-based parser remains the pipeline boundary. A small local block extension recognizes `:::note`, `:::tip`, `:::warning`, and `:::danger` blocks; unsupported names render the original source in a visible fallback. The extension parses each supported body as ordinary Markdown, so article search still sees admonition text. Mermaid and PlantUML fences are intercepted before code highlighting and retain their placeholder/async diagram path.

Math uses `marked-katex-extension` with KaTeX 0.18.9. `$...$` renders inline math and `$$` delimiters on their own lines render display math. Rendering is static and local with `throwOnError: false`, `trust: false`, strict mode, and bounded expansion/size options. KaTeX errors retain visible source/error text. A filtered local KaTeX stylesheet and 20 `.woff2` font payloads are bundled (Vite emits 19 files and inlines the smallest one); legacy `.woff`/`.ttf` assets and network stylesheets are excluded. Search coverage inside math is intentionally partial.

Only a leading YAML front matter block is recognized. The block must start at byte zero with `---` and close with `---` or `...`; it is removed before Markdown parsing and returned as `metadata` from `renderMarkdownDocument`. js-yaml uses `CORE_SCHEMA`, `maxDepth: 20`, and `maxAliases: 0`, and metadata is normalized to plain nested records/arrays. Invalid YAML emits a local warning while rendering the remaining body with empty metadata; an unmatched opening delimiter is left as ordinary Markdown. Metadata does not override toolbar filename/title in Phase 2.

Code highlighting uses `highlight.js/lib/core` with only Bash/shell, CSS, JavaScript, TypeScript, JSON, Markdown, Python, Rust, YAML, and XML/HTML grammars. Aliases are documented in README and unknown labels remain escaped plain code. Highlight spans add color only; existing 13px monospace sizing and horizontal overflow are unchanged. DOMPurify keeps raw HTML escaped, enables the MathML/SVG profiles required by KaTeX without SVG filter primitives, and permits only the specific data/ARIA attributes used by images, diagrams, and math accessibility.

The four Phase 2 packages were checked against npm release history and deprecation metadata on 2026-09-27: `katex@0.18.9` (MIT, 2026-09-23), `marked-katex-extension@5.1.13` (MIT, 2026-09-16), `js-yaml@5.4.2` (MIT, 2026-09-13), and `highlight.js@11.12.0` (BSD-3-Clause, 2026-08-12). None was deprecated and the pinned peer range for the KaTeX extension accepts the current Marked/KaTeX versions. `npm audit --omit=dev` is the release gate for the installed graph.

## Delivery checklist
1. Scaffold frontend/native configuration and implement full interface states.
2. Render GFM Markdown, Mermaid and PlantUML using real engines and bundled assets.
3. Implement open dialog, launch argument/file association, repeated open, macOS open events and drop where platform permits.
4. Implement search and PDF path, handle pending diagrams/errors.
5. Add Phase 2 rich content extensions, sample fixtures, meaningful smoke checks, and docs.
6. Review real diffs and results; distinguish verified frontend, native compilation and actual OS integration.

## Acceptance and validation
- Sample includes headings, table, Unicode, local image, Mermaid flow/sequence, PlantUML sequence/class, malformed diagram.
- Normal text appears even if a diagram fails. Opening another document never receives an old render result.
- Search navigation/counts work and clearing restores content. PDF includes diagrams and excludes app chrome.
- Phase 2 fixture renders offline math, all four supported admonition types, visible unknown-admonition fallback, leading front matter stripped from the body, and every curated highlighting grammar. Invalid YAML/math remain local failures and following content remains readable.
- npm run check, npm test (if meaningful tests added), npm run build. cargo check / native build only when Rust and OS prerequisites available. Browser smoke where available. Do not label cross-platform packages verified until built and exercised on each OS.
- Provisional measurement targets on a documented reference machine: plain 100KB Markdown readable within 1 second cold / 300ms warm; idle whole process-tree memory under 120MB; measure diagram peaks separately. These are engineering targets, not measured results. Record uncompressed and compressed installer size; graph engines may dominate payload.
- Phase 2 Windows measurement on the same workspace baseline: uncompressed frontend `dist/` grew 658,416 bytes (5.26%), the release executable grew 381,952 bytes (2.97%), and the compressed NSIS installer grew 385,859 bytes (7.05%). Exact baseline/current byte counts are recorded in `VERIFICATION.md`.

## Known environment constraints
Workspace initially empty. Node/npm/git were available; Rust/cargo were initially absent. Verification now uses an isolated Rust 1.98.1 toolchain and Microsoft Windows SDK under ignored `.tools/`, together with existing Visual Studio Build Tools. No system-wide toolchain or PATH change was made. Native Windows `cargo check` passes with Tauri 2.12.0 / tauri-build 2.7.0. Linux and macOS builds require their respective runners. No commit/push/release authorized.
