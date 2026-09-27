# Verification — 2026-09-27

Implementation was delegated to GPT-6 Luna with Max reasoning. A separate read-only reviewer checked the native integration and the document-read race fix. Final narrow review found no remaining actionable defect.

## Passed

- Clean `npm ci`, TypeScript `npm run check`, `npm test` (11 tests), and production `npm run build`.
- `npm audit --omit=dev`: zero reported vulnerabilities. Installed Mermaid/Chevrotain `lodash-es` copies resolve to the pinned override 4.18.1.
- Phase 2 rich-content tests cover metadata extraction (including empty and non-leading blocks), inline/display math, local KaTeX error output, all four admonitions plus unknown fallback, a fenced-code marker inside an admonition, curated JavaScript highlighting, unknown-language escaping, and Mermaid placeholder preservation. The current run is `npm run check` passed, `npm test` passed (11 tests), and `npm run build` passed.
- The frontend build ships 20 KaTeX `.woff2` font payloads (19 emitted files and one small Vite-inlined font) and no KaTeX `.woff` or `.ttf` assets. The stylesheet is bundled locally; no CDN or font URL is introduced.
- Windows `cargo check`, using isolated Rust 1.98.1, existing Visual Studio 2022 Build Tools, and a local Microsoft Windows SDK. Three unused-mut warnings remain; no compile errors.
- Phase 2 `npm run tauri:build -- --bundles nsis --ci`, launched through the repository's isolated Windows toolchain script, built the release executable and NSIS installer successfully with Tauri Rust/API/CLI 2.12.0. The existing three `unused_mut` Rust warnings remain; there were no build errors.
- Browser smoke with real DOMPurify rendered two KaTeX expressions plus one visible math error, five admonition containers, 32 highlight spans, four diagram SVGs plus one contained diagram error, and no leaked front matter or console warnings/errors. The narrowed policy preserved MathML while disabling SVG filter primitives and arbitrary data/ARIA attributes in the Markdown sanitizer.
- Headless Edge browser acceptance: Unicode, Markdown table, Mermaid flow/sequence, PlantUML sequence/class, isolated malformed-diagram error, script/unsafe-link containment, no external rendering requests, search count/navigation, replacement file, unsupported-file retention, print invocation and article-only print layout.
- Dark appearance at 640px: readable diagram labels and no document-level horizontal overflow, visually inspected.
- PDF generated from the rendered article in Chromium: two pages with diagrams and Unicode. Both rasterized pages were visually inspected using Poppler.
- Actual release executable, controlled through WebView2 with a temporary debugging environment variable: startup Markdown argument, four rendered SVG diagrams, local raster image, search, and second-process file delivery into the existing window all passed. Test process was closed afterward. Debugging is not enabled in the shipped app configuration.

## Windows artifacts

| Artifact | Phase 1 baseline | Phase 2 | Delta |
|---|---:|---:|---:|
| Uncompressed frontend `dist/` | 12,526,306 bytes | 13,184,722 bytes | +658,416 bytes (+5.26%) |
| `src-tauri/target/release/markdown-preview-plus.exe` | 12,853,760 bytes | 13,235,712 bytes | +381,952 bytes (+2.97%) |
| `src-tauri/target/release/bundle/nsis/Markdown Preview Plus_1.0.0_x64-setup.exe` | 5,475,175 bytes | 5,861,034 bytes | +385,859 bytes (+7.05%) |

The executable uses the system WebView2 runtime. Installer size does not represent total system runtime usage. Development-only toolchains in ignored `.tools/` are not included in the app.

The Phase 2 installer is the compressed delivery measurement; the executable and frontend totals are uncompressed. The app still uses the system WebView2 runtime, which is not included in these artifact sizes.

## Not yet verified

- Linux `.deb` and macOS `.app`/`.dmg` builds and runtime behavior. The GitHub Actions matrix is provided but has not been run remotely.
- Installation/uninstallation and Explorer Open With behavior. The installer was built; it was not installed. Launch arguments and single-instance delivery were exercised directly.
- Actual OS print-dialog interaction and a user-selected PDF save destination. Browser PDF output and application print invocation were verified separately.
- Linux/macOS rich-content runtime behavior remains unverified.
- Cold-start timing, full process-tree RAM consumption, and diagram memory peaks. Performance numbers in PLAN.md are targets, not measured results.
- Code signing/notarization; local Windows artifacts are unsigned.

No Git commit, push, or public release was performed.
