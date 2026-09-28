# Verification — 2026-09-27

This verification records the repository-audit remediation, the complete 15-item UI feedback pass, and the Windows `1.0.1` release artifact checks. The evidence below records commands run against the working tree after the changes. The installer was built and published with the release; silent installation and a no-document cold start were verified afterward, while uninstallation and full native interaction remain unverified.

## Search UX follow-up — 2026-09-28

- Search navigation now keeps the active match below the floating panel, places an off-screen match around 30% down the reading viewport, and switches to instant scrolling during rapid repeated navigation.
- Search supports F3 / Shift+F3, a separate subtle clear-query button, the `current / total` counter format, and a calm warning-colored **No results** state. Existing Enter/Shift+Enter and Escape behavior remains unchanged.
- `npm run check` — passed.
- `npm test` — passed: 3 test files and 22 tests, including rich visible-text search coverage with diagram/hidden-content exclusions.
- `npm run build` — passed; Vite emitted only the existing large-chunk warnings.
- `npm audit --omit=dev` — passed with 0 reported vulnerabilities.
- Windows NSIS build via `.tools\\build-windows.cmd` — passed; installer `src-tauri/target/release/bundle/nsis/Markdown Preview Plus_1.0.1_x64-setup.exe` is 5,872,889 bytes / 5.60 MiB. SHA-256: `E1B5B95840D29010C2975BFE5EADFE659945CCD041D9385D4C4C41D14EEF2C71`.
- Release executable is 13,321,216 bytes. SHA-256: `6A8950987B1B733BD7CF062C8D4F19ABDBAE27B7E0A876F0E0096EA486AE8617`.
- `git diff --check` — passed; Git reported only its existing CRLF normalization warnings.
- Manual light/dark fixture smoke, installer launch/uninstall, and Linux/macOS builds/runtime checks were not run in this follow-up.

## Branding and search-highlight follow-up — 2026-09-28

- Replaced the indigo accent family with neutral charcoal/gray values for branding, focus, active navigation, and TOC states; the active search match now uses a darker gold fill with contrasting text and no red outline.
- `npm run check` — passed.
- `npm test` — passed: 3 test files and 22 tests.
- `npm run build` — passed; Vite emitted only the existing large-chunk warnings for bundled diagram runtimes.
- `npm audit --omit=dev` — passed with 0 reported vulnerabilities.
- `.tools\\build-windows.cmd` — passed; NSIS installer `src-tauri/target/release/bundle/nsis/Markdown Preview Plus_1.0.1_x64-setup.exe` is 5,873,893 bytes / 5.60 MiB. SHA-256: `FE4DD31C0DE7D9D0C206269ED42A48E3E18AE2B62D58422783E55B3EF7D784EC`.
- Release executable `src-tauri/target/release/markdown-preview-plus.exe` is 13,321,216 bytes. SHA-256: `D74E6DC7DBE41F850644A3F204E9D13BF11C722B7880BCB4C7F03CDCC199F53D`.
- Frontend `dist/` output is 13,184,777 bytes. `git diff --check` passed; Git reported only existing CRLF normalization warnings.
- Manual light/dark fixture smoke, installer launch/uninstall, and Linux/macOS builds/runtime checks were not run.

## 1.0.1 UI and Windows release validation

- All 15 items in `markdown-preview-plus-ui-review-v2.md` were implemented, including compact neutral toolbar/search, explicit search states, resizable/collapsible TOC hierarchy, quieter scrolling, adaptive prose-versus-technical widths, tighter typography, and semantic color usage.
- `npm run check` — passed.
- `npm test` — passed: 3 test files and 19 tests.
- `npm run build` — passed; Vite emitted only the existing large-chunk warnings.
- `npm audit --omit=dev` — passed with 0 reported vulnerabilities.
- `.tools\\cargo\\bin\\cargo.exe +stable-x86_64-pc-windows-msvc fmt --manifest-path src-tauri\\Cargo.toml -- --check` — passed.
- `.tools\\check-native.cmd` — passed; native library tests passed with 7 tests.
- Windows NSIS build — passed and produced `src-tauri/target/release/bundle/nsis/Markdown Preview Plus_1.0.1_x64-setup.exe` (5,874,374 bytes / 5.60 MiB).
- Installer SHA-256: `5BB91ED55FB3B99B300F84AA021891138F548CEF0D6BEBA6BD2F6F5F452F16F3`.
- Release executable: `src-tauri/target/release/markdown-preview-plus.exe` (13,320,704 bytes), SHA-256 `66B233A8E5044BBBDF83F70508B17DF59627E2249A9033E5E72DC54F0DC742D5`.
- Browser smoke on a clean Vite preview passed for the initial empty state: the compact toolbar showed Open while Find/PDF remained disabled, the empty-state guidance was visible, and no new console errors were recorded after fixing the search-divider markup. Loading `fixtures/reader-demo.md` through the browser automation file chooser was not available, so fixture rendering was not claimed as a browser smoke result.
- Silent NSIS installation with `/S` — passed with exit code 0. The installed executable at `%LOCALAPPDATA%\\Markdown Preview Plus\\markdown-preview-plus.exe` reported product/file version `1.0.1`.
- Installed executable cold start — passed: the process remained running, reported window title `Markdown Preview Plus`, and was responsive. A command-line launch with `fixtures/reader-demo.md` was attempted separately, but the title did not change, so native startup document delivery is not claimed as passed.
- `git diff --check` — passed; only CRLF normalization warnings were reported by Git.

## Passed in this pass

- `npm run check` — passed (`tsc --noEmit`).
- `npm test` — passed: 3 test files and 19 tests. This includes the real DOMPurify path under `jsdom@26.1.0`, locale-sensitive Unicode search-offset regressions, and the existing read/search/content coverage.
- `npm run build` — passed with Vite 8.3.1. The existing large-chunk warnings for bundled diagram runtimes remain; no production dependency was added for the sanitizer tests.
- `npm audit --omit=dev` — passed with 0 reported vulnerabilities.
- `npm ls lodash-es --all` — passed. Mermaid's transitive copies resolve to the root override `lodash-es@4.18.1`; `lodash-es` is not a direct dependency.
- `.tools\cargo\bin\cargo.exe +stable-x86_64-pc-windows-msvc fmt --manifest-path src-tauri\Cargo.toml -- --check` — passed.
- `.tools\check-native.cmd` — passed for the Windows native `cargo check` path using the repository's isolated toolchain. The script still prints an environment setup message from the local Visual Studio probe, but exited successfully and produced no Rust warnings.
- Native library tests through the isolated Windows toolchain — passed: 7 tests. The tests cover Markdown extension/startup filtering, relative-image policy, authorization, stale document grants, traversal/symlink boundaries where supported, image signatures, and document/image size limits.
- `.github/workflows/desktop-build.yml` now runs `cargo test --manifest-path src-tauri/Cargo.toml --lib` in every existing Windows, Linux, and macOS matrix job before the native bundle build. Remote CI execution was not run in this workspace.

## Environment note

- `npm ci --ignore-scripts` — failed before completion because Windows returned `EPERM` while unlinking Vite's native Rolldown binary. `npm install --ignore-scripts` restored the same lockfile dependency graph successfully and reported 0 vulnerabilities; all frontend checks above were rerun afterward.

## Changes covered by the checks

- Native document reads now consume a Rust-owned pending path atomically or open a file through the native asynchronous dialog. Each successful response carries only its name, content, and opaque document grant; the frontend has no arbitrary path argument and receives no native document path. Startup, file-association, second-instance, macOS open, and desktop-drop flows remain represented by the Rust queue. Duplicate notifications with no pending document are harmless.
- Local image reads require the current document grant and remain relative to the native authorized document. The grant lock atomically rejects stale A requests after B is authorized, while retaining canonicalization, traversal, symlink, size, MIME, and signature checks.
- Local image decoding is bounded to four concurrent workers. Search input is coalesced with a short debounce, keyboard navigation flushes pending input immediately, and print preparation flushes pending search work before clearing/restoring highlights.
- Search preserves locale-sensitive matching while mapping lowercase expansions back to their original grapheme ranges, including Turkish casing, Lithuanian combining-mark context, dotted-I, and Greek final sigma.
- Real DOMPurify regression tests run through the `jsdom` environment and cover dangerous HTML, SVG, URL, event-handler, and data-attribute input, plus surviving KaTeX math and local image/diagram attributes through the full Markdown rendering path.
- The three unnecessary Rust `mut` qualifiers and the unused `#app` selector were removed. The direct `lodash-es` dependency was removed while its `4.18.1` transitive override remains in the lockfile.

## Not run in this pass

- Native toolbar picker, file-association launch, second-instance document delivery, drag/drop, and document rendering through the installed app remain unverified. A direct command-line fixture launch was attempted but did not visibly load the fixture.
- Installer uninstallation was not run.
- `npm run tauri:build`, installer installation/uninstallation, Explorer Open With behavior, Linux/macOS builds, and Linux/macOS runtime checks were not run.
- Actual OS print-dialog interaction and user-selected PDF destination were not run. Browser print output and the frontend print invocation remain prior evidence.
- Cold-start timing, full process-tree memory, diagram peak memory, code signing, and notarization were not measured.

## Prior Phase 2 artifact measurements

These measurements were recorded before the audit remediation and are retained as historical context; they are not a claim about the `1.0.1` installer above.

| Artifact | Phase 1 baseline | Phase 2 | Delta |
|---|---:|---:|---:|
| Uncompressed frontend `dist/` | 12,526,306 bytes | 13,184,722 bytes | +658,416 bytes (+5.26%) |
| `src-tauri/target/release/markdown-preview-plus.exe` | 12,853,760 bytes | 13,235,712 bytes | +381,952 bytes (+2.97%) |
| `src-tauri/target/release/bundle/nsis/Markdown Preview Plus_1.0.0_x64-setup.exe` | 5,475,175 bytes | 5,861,034 bytes | +385,859 bytes (+7.05%) |

The historical executable uses the system WebView2 runtime. Development-only toolchains in ignored `.tools/` are not included in the app. Linux/macOS artifacts and cross-platform runtime behavior remain unverified.
