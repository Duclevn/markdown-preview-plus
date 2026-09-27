# Markdown Preview Plus

Markdown Preview Plus is a read-only desktop reader for one Markdown file at a time. Open a `.md` or `.markdown` file from the toolbar, drop one file onto the window, or open it from the operating system after installing the app. The app does not edit the source file.

## Run and build

Install the project dependencies with `npm ci`. The browser preview uses Vite; the desktop app also needs the Rust and platform prerequisites described in the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/).

```sh
npm run dev
npm run tauri:dev
npm run check
npm test
npm run build
npm run tauri:build
```

`npm run dev` starts the frontend with a browser file picker for development. Local relative images and operating system file events require the Tauri desktop host. Build installers on their target operating systems; an installer has not been verified for every platform unless that platform's CI build and launch have passed.

## Read, search, and print

The compact toolbar uses neutral Open, Find, and PDF actions; the coral accent is reserved for focus, active navigation, selection, and the empty-state primary action. When a document has headings, the left Table of contents sidebar opens by default at about 272px wide, can be resized, and can be collapsed with its accessible arrow control so the article expands. Its real heading links smooth-scroll through the reading area, H1–H3 remain easy to scan, and deeper headings are visually quieter. The collapse state is kept only in the current session and is not persisted. Shortcuts are Ctrl+O / Cmd+O to open, Ctrl+F / Cmd+F to search, and Ctrl+P / Cmd+P to print.

Prose uses a readable line length, while tables, code, XML/JSON, and diagrams can use the available article width and scroll horizontally when needed. Find is a compact upper-right utility: an empty query shows only the input, matches show the count and navigation buttons, and a non-empty query with no matches shows **No results**.

Search covers visible Markdown text, including code blocks and tables. Diagram labels and the source inside diagram blocks are excluded. Search highlights are removed when the search closes and do not appear in print.

Export PDF waits for local image and diagram work to finish, then opens the system print dialog. Choose **Save as PDF** there to create a PDF. The app does not infer whether the print dialog saved or canceled the file. Print layout contains the article and rendered diagrams, without the toolbar or search pill.

## Supported content and privacy

GitHub-flavored Markdown is parsed locally. Mermaid and PlantUML run in the app's bundled JavaScript assets; diagram requests are not sent to a server. The PlantUML bundle includes its built-in theme definitions, emoji, and OpenIconic assets. Other PlantUML standard-library packages such as C4 are not bundled, and remote includes are blocked.

Phase 2 adds four offline extensions while retaining the Marked renderer:

- Math uses `$...$` for inline formulas and `$$` on its own lines for display formulas. KaTeX 0.18.9 is rendered at parse time with local CSS and only bundled `.woff2` fonts. KaTeX's visible error output is retained for invalid or untrusted commands; search coverage for math is partial because the accessible MathML/source representation differs from the visible glyphs.
- Admonitions use `:::note`, `:::tip`, `:::warning`, and `:::danger`, closed by `:::`. Their bodies are ordinary Markdown and remain searchable. An unknown type renders a visible source fallback instead of being discarded.
- A leading YAML block delimited by `---` and `---`/`...` is removed from the article and safely parsed into the renderer's metadata result. Metadata never overrides the toolbar filename. Invalid YAML shows a local warning and the remaining body still renders; an unmatched opening delimiter is treated as ordinary Markdown to avoid hiding content.
- Fenced code highlighting is limited to Bash/shell (`bash`, `shell`, `sh`), CSS (`css`), JavaScript (`javascript`, `js`), TypeScript (`typescript`, `ts`), JSON (`json`), Markdown (`markdown`, `md`), Python (`python`, `py`), Rust (`rust`, `rs`), YAML (`yaml`, `yml`), and XML/HTML (`xml`, `html`). Other language labels remain escaped plain code. Diagram fences are intercepted before highlighting and keep their existing layout.

Relative PNG, JPEG, GIF, WebP, and BMP images are read from the Markdown file's folder and its subfolders. The native host rejects path traversal, symlink escapes, unsupported image types, and oversized files. Remote images are not loaded. HTTP and HTTPS links are shown as links and open in the system browser only after the reader selects them.

Document paths stay inside the native host. In the desktop app, Open File asks the native file dialog to choose a document, while startup arguments, file-association launches, second-instance events, and desktop drops are queued and validated in Rust. The WebView can consume the resulting document and its opaque document grant, but it never submits an arbitrary native path to a read command. Local image requests carry only a relative path plus the current grant; a new document invalidates older grants before image resolution. Browser development mode keeps its separate browser-owned file input.

Raw HTML is displayed as text. Dangerous URL schemes and script callbacks are disabled, Mermaid runs in strict mode, generated SVG is sanitized before display, and the KaTeX/highlight/admonition output is sanitized with the required MathML/SVG profiles but without SVG filter primitives or arbitrary data/ARIA attributes. Front matter uses js-yaml's `CORE_SCHEMA` with bounded depth and aliases disabled. This reader has no editor, telemetry, account, sync, background service, or automatic file writes.

## Library maintenance check

The pinned packages below were checked against npm registry metadata on September 27, 2026. Each version had no deprecation notice and pointed to its upstream project. The release dates are from the registry's version history. Recent releases are evidence of maintenance at the time of the check, not a guarantee of future support.

| Library | Pinned version | Registry release | Upstream |
|---|---:|---:|---|
| `@plantuml/core` | `1.2026.8` | 2026-09-06 | [PlantUML](https://github.com/plantuml/plantuml) |
| `mermaid` | `12.0.0` | 2026-09-10 | [Mermaid](https://github.com/mermaid-js/mermaid) |
| `marked` | `18.0.14` | 2026-09-22 | [Marked](https://github.com/markedjs/marked) |
| `dompurify` | `3.4.16` | 2026-09-23 | [DOMPurify](https://github.com/cure53/DOMPurify) |
| `katex` | `0.18.9` | 2026-09-23 | [KaTeX](https://github.com/KaTeX/KaTeX) |
| `marked-katex-extension` | `5.1.13` | 2026-09-16 | [marked-katex-extension](https://github.com/UziTech/marked-katex-extension) |
| `js-yaml` | `5.4.2` | 2026-09-13 | [js-yaml](https://github.com/nodeca/js-yaml) |
| `highlight.js` | `11.12.0` | 2026-08-12 | [highlight.js](https://github.com/highlightjs/highlight.js) |
| `jsdom` (dev only) | `26.1.0` | 2025-04-13 | [jsdom](https://github.com/jsdom/jsdom) |
| `@tauri-apps/api` | `2.12.0` | 2026-09-26 | [Tauri](https://github.com/tauri-apps/tauri) |
| `@tauri-apps/cli` | `2.12.0` | 2026-09-26 | [Tauri](https://github.com/tauri-apps/tauri) |

The selected PlantUML package is the official TeaVM-based `@plantuml/core`, not the discontinued CheerpJ-based `plantuml-core` integration or the older `plantuml.js` project. Its pinned release is MIT-licensed. Mermaid's current parser dependency graph includes nested `lodash-es` packages; the lockfile overrides those copies to `4.18.1` to address the high-severity advisories found by `npm audit` without forcing a Mermaid major-version change. `lodash-es` is retained as a lockfile override only; it is not a direct application dependency.

The Phase 2 dependency gate checked npm version history and deprecation metadata on September 27, 2026. `katex` (MIT), `marked-katex-extension` (MIT), and `js-yaml` (MIT) had releases on September 23, 16, and 13; `highlight.js` (BSD-3-Clause) released on August 12. `jsdom@26.1.0` (MIT, Node `>=18`) was released on April 13, 2025 and is used only by the real DOMPurify regression tests. None of these direct packages had a deprecation notice. npm reports a deprecation notice for the dev-only transitive `whatwg-encoding@3.1.1`; it is not part of the shipped production graph. `npm audit --omit=dev` reported no vulnerabilities at verification time. KaTeX's peer ranges accept the pinned Marked and KaTeX versions. The frontend bundle imports KaTeX's CSS from a checked-in filtered copy so only the 20 required `.woff2` font payloads are shipped (19 emitted files and one small Vite-inlined font); legacy `.woff` and `.ttf` files are not shipped.

## Example fixture

Open [`fixtures/reader-demo.md`](fixtures/reader-demo.md) to see the included front matter, math, admonitions, all curated code languages, local image, Mermaid, PlantUML, and contained-error examples. The app starts empty and never loads the fixture automatically.
