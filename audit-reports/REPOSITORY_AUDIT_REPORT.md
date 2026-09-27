# Repository Audit Report

## 1. Audit Metadata

- **Repository:** C:\AI\markdown-preview-plus — Markdown Preview Plus
- **Branch / commit:** main / 230b9d55acf7723606e53b4e9da3e46a3cee67be
- **Audit date:** 2026-09-27
- **Model:** GPT-6 (Codex)
- **Working tree at start:** Clean; no tracked or untracked changes reported.
- **Repository size:** 115 tracked files, approximately 4,889,413 bytes including assets and generated schemas.
- **Scope:** Frontend TypeScript/CSS/HTML, Rust host, Tauri permissions/configuration, package and Cargo manifests/lockfiles, tests, CI workflow, documentation, fixtures, and asset usage.
- **Exclusions:** node_modules, dist, src-tauri/target, and generated/vendor implementation code were excluded from ordinary source-quality review. Bundled PlantUML and KaTeX assets were considered for ownership and loading, not audited line by line.
- **Commands/tools used:** Git metadata/status/listing; rg file and text searches; PowerShell Get-Content/Select-String and file-size measurement; npm ls --depth=0; npm ls lodash-es --all; official Tauri v2 capability/permission documentation.
- **Project commands not run:** npm run check, npm test, npm run build, npm audit, Cargo checks/tests, Tauri build, or runtime/browser smoke. This was a read-only review, and no implementation change was requested.
- **Output:** This report was created under audit-reports after the user approved that location. No application source file was modified.

## 2. Executive Summary

The project is a focused, reasonably well-separated reader. Parsing and sanitizing, diagrams, search, the native file boundary, and window coordination have clear ownership. The app also makes several good size and security choices: diagrams are dynamically imported, all render assets are local, raw HTML is escaped, links are restricted, local images are raster-only and path-checked, and document/image sizes are capped.

The most important issue is the native IPC boundary: the registered read_document command accepts a caller-supplied absolute path and returns any readable Markdown file, without requiring that Rust granted that path through a native file-selection flow. Tauri v2 allows registered application commands to all app WebViews by default unless the app command manifest is restricted. Normal Markdown is not shown to execute JavaScript, so exploitation requires a compromised WebView script; reducing the impact of that class of compromise is still important for a reader that processes untrusted documents.

Two confirmed performance risks are eager image work across the whole article and a full article search rewrite on every input event. A further test gap leaves the final DOMPurify policy untested: Vitest replaces DOMPurify with an identity function. No rewrite is justified; the highest-value work is to narrow the file-read authority, exercise the real sanitizer/native path rules in tests, and bound expensive UI work.

No Critical or High issue was found in this static review. The Medium findings below are worth addressing before treating the rendered-document security boundary as defense in depth.

## 3. Product Understanding

Markdown Preview Plus is a read-only desktop reader for one Markdown document at a time. It opens Markdown through the toolbar, drop events, or OS file associations; renders local GFM; supports Mermaid, PlantUML, math, admonitions, YAML front matter, and curated code highlighting; and provides a TOC, search, and system print dialog.

The main flow is:

1. A selected, dropped, startup, or second-instance path reaches the frontend.
2. The frontend asks the Tauri Rust host to read the Markdown file.
3. The frontend renders Markdown with Marked, custom URL/image/code/heading rules, and DOMPurify.
4. Local images are read through a separate native command; diagrams are rendered asynchronously through local Mermaid and PlantUML assets and their SVG is sanitized.
5. Search and TOC operate on the rendered article; print waits for local image and diagram work.

Document content is held in memory for reading. The app does not persist edits. External systems are the OS file dialog/browser/print dialog and Tauri’s native bridge; diagram rendering and fonts are bundled locally.

## 4. Architecture Overview

src/main.ts coordinates document state, TOC, search UI, image loading, and printing. src/markdown.ts owns parsing, metadata, URL/image policies, highlighting, and the final HTML sanitizer. src/diagrams.ts lazy-loads render engines and sanitizes output SVG. src/search.ts is a focused DOM search helper. src-tauri/src/lib.rs owns native document/image reads and OS-open delivery.

    flowchart TD
      OS["Dialog, drop, startup path"] --> Rust["Tauri Rust host"]
      Rust --> Main["src/main.ts"]
      Main --> Markdown["src/markdown.ts: Marked and DOMPurify"]
      Main --> Search["src/search.ts"]
      Main --> Diagrams["src/diagrams.ts: lazy engines and SVG sanitizer"]
      Main -->|scoped image IPC| Rust
      Main --> Print["System print dialog"]

**Strengths**

- Responsibilities are divided by trust boundary and rendering feature rather than placed in a single parser/UI module.
- Diagram engines are dynamically imported only when a matching fence exists; PlantUML and Mermaid jobs run sequentially.
- The Rust host canonicalizes paths, limits document/image sizes, checks image signatures, rejects unsupported image types, and restricts images to the current document directory.
- The latest-open queue prevents an older file read from replacing a newer request.
- The app uses local dependencies and fonts, with no CDN or remote diagram service.

**Concern**

- Native command authority is wider than the file-selection UX implies; see F-01.

## 5. Build and Test Results

No project build, test, type-check, audit, or runtime command was run during this review.

The checked-in VERIFICATION.md records a prior verification on 2026-09-27: TypeScript check, 11 Vitest tests, frontend build, npm audit with zero reported vulnerabilities, Windows cargo check, Windows NSIS build, browser smoke, and a Windows runtime smoke. It also records three unused-mut compiler warnings. These are repository-documented results, not results reproduced in this audit.

That document marks Linux/macOS builds and runtime, actual OS print-dialog save behavior, cold-start timing, full process memory, diagram memory peaks, signing, and notarization as not yet verified.

The CI workflow installs with npm ci, runs npm run check and npm test, then builds a Tauri bundle for Windows, Linux, and macOS. Tauri’s configured beforeBuildCommand runs the Vite production build. The workflow has not been run as part of this audit.

## 6. Findings Summary

| ID | Category | Severity | Confidence | Title | Location |
|---|---|---:|---|---|---|
| F-01 | Security | Medium | Confirmed | Native document command accepts arbitrary caller-supplied Markdown paths | src-tauri/src/lib.rs:35-79, 275-279 |
| F-02 | Performance | Medium | High | Local images are loaded eagerly with unbounded frontend work | src/main.ts:304-337; src/markdown.ts:323-331 |
| F-03 | Performance | Medium | High | Search rewrites the full article for every keystroke | src/main.ts:98-101, 466; src/search.ts:17-65 |
| F-04 | Testing / Security | Medium | High | Tests bypass the production sanitizer and omit native path-policy tests | tests/security.test.ts:3-7; src/markdown.ts:347-383 |
| F-05 | Correctness | Low | High | Unicode case folding can shift search-highlight offsets | src/search.ts:19, 34-49 |
| F-06 | Build / Cleanup | Low | Confirmed | Rust build retains three documented unused-mut warnings | src-tauri/src/lib.rs:51, 125, 209 |
| F-07 | Dead code | Low | Confirmed | CSS still targets a nonexistent #app element | src/styles.css:59-66; index.html:10-12 |
| F-08 | Dependency hygiene | Informational | Medium | lodash-es direct dependency may duplicate the transitive pin | package.json:25, 30-31 |

## 7. Critical and High Findings

No Critical or High findings were identified in this static review.

## 8. Medium and Low Findings

### F-01 Native document command accepts arbitrary caller-supplied Markdown paths

- **Category:** Security
- **Severity:** Medium
- **Confidence:** Confirmed for command exposure; the impact requires compromised WebView JavaScript.
- **Location:** src-tauri/src/lib.rs:35-79, 275-279; src-tauri/capabilities/default.json:6-11; src-tauri/build.rs:1-4
- **Evidence:** read_document receives path: String, canonicalizes it, checks only the .md/.markdown extension, regular-file status, 20 MiB limit, and UTF-8, then returns the content and sets it as the authorized document. It does not verify that the path came from a native chooser or a native-issued grant. The command is registered in invoke_handler. The capability file grants dialog and opener plugin commands, but there is no app command manifest restricting the custom commands. Tauri’s official [Capabilities documentation](https://v2.tauri.app/security/capabilities/) says registered app commands are available to all app WebViews by default unless the app manifest changes that.
- **Why it matters:** If JavaScript in the WebView is compromised, it can call read_document for another known or guessed local Markdown path and read the returned content. The opener URL permission could also be abused to navigate to an attacker-controlled URL with data, subject to that same compromise. Normal Markdown currently enters escaped/sanitized paths, so this is a defense-in-depth boundary concern, not evidence of a Markdown-to-script exploit.
- **Trigger or precondition:** A WebView script compromise plus a readable Markdown path.
- **Recommendation:** Make native code own file selection and reading, or issue a short-lived native grant for paths opened through the OS/startup event. Do not use an arbitrary frontend-supplied path as the authority to read a file. Preserve the current image restriction to the authorized document folder.
- **Verification:** From a WebView test harness, invoke read_document on a Markdown path that was not opened through the app and confirm denial; also confirm chooser, drop, launch-argument, and second-instance flows still work.
- **Estimated effort:** Medium
- **Change risk:** Medium
- **Status:** Confirmed issue with conditional exploit precondition

### F-02 Local images are loaded eagerly with unbounded frontend work

- **Category:** Performance / resource usage
- **Severity:** Medium
- **Confidence:** High
- **Location:** src/main.ts:304-337; src/markdown.ts:323-331; src-tauri/src/lib.rs:83-145
- **Evidence:** The Markdown renderer creates one img element for each local image. loadLocalImages finds all of them immediately and starts every read_local_image invocation through a single Promise.all. There is no per-document image-count or aggregate byte limit. The Rust command caps each image at 5 MiB, but holds the authorization mutex while reading and base64-encoding, so native image reads serialize while frontend requests and decoded image work can accumulate.
- **Why it matters:** A document with many or several large images can create a large queue of IPC calls, base64 strings, and decoded image surfaces, increasing memory and making the UI/print preparation slow.
- **Trigger or precondition:** A Markdown document containing many local images, especially several large images or offscreen images.
- **Recommendation:** Bound image tasks to a small worker pool and consider lazy-loading offscreen images. Keep print preparation responsible for loading any images still pending before calling window.print().
- **Verification:** Use an instrumented read mock with many images; assert a concurrency cap, successful and failed placeholders, document replacement behavior, and that printing waits for all required images.
- **Estimated effort:** Small to medium
- **Change risk:** Low

### F-03 Search rewrites the full article for every keystroke

- **Category:** Performance / responsiveness
- **Severity:** Medium
- **Confidence:** High
- **Location:** src/main.ts:98-101, 466; src/search.ts:17-65
- **Evidence:** Each input event immediately calls searchArticle. It removes existing marks, normalizes the article, walks searchable text nodes, lowercases them, replaces matching nodes with fragments, then loops over every match to set the current result. Moving to another result also updates every match.
- **Why it matters:** Large documents or common short queries can trigger substantial DOM traversal, allocation, and layout work on every typed character.
- **Trigger or precondition:** A long document, frequent query, or fast typing.
- **Recommendation:** Coalesce input with a short debounce or animation frame while preserving Enter/Shift+Enter navigation. Avoid a larger search rewrite unless profiling shows the simpler scheduling change is insufficient.
- **Verification:** Profile rapid typing against a large article with many matches and confirm navigation, count, and mark cleanup remain correct.
- **Estimated effort:** Small
- **Change risk:** Low

### F-04 Tests bypass the production sanitizer and omit native path-policy tests

- **Category:** Testing / Security regression prevention
- **Severity:** Medium
- **Confidence:** High
- **Location:** tests/security.test.ts:3-7, 62-137; src/markdown.ts:347-383; src-tauri/src/lib.rs
- **Evidence:** Vitest mocks DOMPurify with an identity sanitizer, so Markdown rendering tests inspect unsanitized HTML rather than the final production policy. The Node test environment has no real DOM test path. The Rust host contains the file size, path, image-type, and image-signature security checks but no Rust unit tests are present; CI runs npm test and a Tauri build, not cargo test.
- **Why it matters:** A change to allowed tags/attributes/protocols or native path checks could regress without these tests detecting it. VERIFICATION.md records manual browser smoke, which is useful evidence but does not protect future changes in CI.
- **Trigger or precondition:** Any future sanitizer profile, renderer extension, or native file-policy change.
- **Recommendation:** Keep the fast renderer tests, and add a real DOMPurify/browser integration check for raw HTML, event attributes, SVG references, data attributes, and required KaTeX/diagram markup. Add focused Rust tests for extension/size/path/signature boundaries.
- **Verification:** Demonstrate that the actual sanitizer removes malicious payloads while preserving supported output, and that native tests reject traversal, symlink escape, wrong signatures, oversized files, and unselected paths.
- **Estimated effort:** Medium
- **Change risk:** Low

### F-05 Unicode case folding can shift search-highlight offsets

- **Category:** Correctness
- **Severity:** Low
- **Confidence:** High
- **Location:** src/search.ts:19, 34-49
- **Evidence:** The code searches indices in text.toLocaleLowerCase() and then uses those indices to slice the original text. Some Unicode lowercase mappings expand to more UTF-16 code units; for example, U+0130 can lowercase to “i” plus a combining dot in common locales. A later match can therefore be found at a different offset than its location in the original string, causing the wrong text range to be wrapped.
- **Why it matters:** Search counts can be correct while the visible highlight starts or ends at the wrong character for some international text.
- **Trigger or precondition:** A searchable text node containing a length-changing case mapping before a match, under a locale where that mapping expands.
- **Recommendation:** Preserve a mapping from folded-text offsets back to source offsets, or use a matcher that reports ranges against the original text.
- **Verification:** Add a case-insensitive search regression for text such as “İfoo” and verify the highlighted range matches exactly “foo”.
- **Estimated effort:** Small
- **Change risk:** Low
- **Status:** Confirmed edge-case defect

### F-06 Rust build retains three documented unused-mut warnings

- **Category:** Build / cleanup
- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** src-tauri/src/lib.rs:51, 125, 209
- **Evidence:** VERIFICATION.md records three unused-mut warnings from Windows cargo check. The corresponding bindings are let mut file for files consumed by take(), and Ok(mut pending) in the frontend_ready match arm, where the binding is not mutated.
- **Why it matters:** The warnings add noise to native build output and make future warnings easier to miss; there is no runtime impact.
- **Trigger or precondition:** Every native build that emits these warnings.
- **Recommendation:** Remove only the unnecessary mut qualifiers.
- **Verification:** Run cargo check and confirm these three warnings are gone without changing behavior.
- **Estimated effort:** Tiny
- **Change risk:** Low

### F-07 CSS still targets a nonexistent #app element

- **Category:** Dead code / cleanup
- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** src/styles.css:59-66; index.html:10-12
- **Evidence:** The shared width/min-height rule targets html, body, and #app, but index.html contains .app-shell as the root element and no element with id="app". The standalone PlantUML QC page also has no #app element.
- **Why it matters:** This selector has no effect and appears to be leftover starter styling. Its runtime impact is negligible.
- **Trigger or precondition:** Always.
- **Recommendation:** Remove #app from that selector after confirming no external development harness injects it.
- **Verification:** Visually inspect empty, reading, narrow-window, and print states.
- **Estimated effort:** Tiny
- **Change risk:** Low

### F-08 lodash-es direct dependency may duplicate the transitive pin

- **Category:** Dependency hygiene
- **Severity:** Informational
- **Confidence:** Medium
- **Location:** package.json:25, 30-31; package-lock.json
- **Evidence:** No application source imports lodash-es. npm ls shows Mermaid/Chevrotain consume it transitively, while the root package also declares lodash-es directly and sets the same root override to 4.18.1.
- **Why it matters:** This makes the root dependency intent less clear. It does not appear to reduce the shipped JavaScript bundle because the app does not import it and Mermaid still needs the transitive package.
- **Trigger or precondition:** Always.
- **Recommendation:** Confirm whether the direct declaration is intentionally required for the override workflow. If it is only duplicated pinning, validate that the transitive override remains locked before removing the direct entry.
- **Verification:** After any approved manifest edit, inspect npm ls and the lockfile and run the normal frontend checks.
- **Estimated effort:** Tiny
- **Change risk:** Low
- **Status:** Candidate; verify npm override behavior before cleanup

## 9. Dead, Unused, and Redundant Code Candidates

- **Confirmed unused:** The #app CSS selector in F-07.
- **Candidate dependency cleanup:** lodash-es direct dependency in F-08. It remains required transitively by Mermaid, so removing the direct declaration should not be presented as a bundle-size optimization.
- **Not classified as dead:** plantuml-qc.html is a standalone manual QC page by design. fixtures/syntax-showcase.md is not referenced by README, but is a plausible manual sample. Confirm whether maintainers still use these before removing them.
- No confirmed unused application module, Rust helper, or bundled asset was found. PlantUML/KaTeX files have external/runtime loading paths and should not be deleted based on repository text search alone.

## 10. Security Assessment

**Existing mitigations**

- Raw HTML is escaped; Marked output is sanitized before insertion.
- Links are restricted to HTTP/HTTPS and credentials in URLs are rejected.
- Remote images and remote diagram services are not used.
- Local image paths reject traversal and symlink escape; the Rust host checks supported raster signatures and per-file size.
- Mermaid uses strict security settings; generated SVG is sanitized and external references are removed.
- CSP blocks remote script/network sources in the production Tauri configuration.
- YAML aliases are disabled and parsing depth is bounded; KaTeX trust is disabled and size/expansion limits are set.

**Finding**

F-01 remains the main security concern: the native read command is a broad capability exposed to WebView JavaScript. The sanitizer reduces the chance of untrusted Markdown becoming script, but should not be the only barrier protecting arbitrary local Markdown reads.

No current dependency vulnerability was checked during this audit. VERIFICATION.md reports a prior npm audit --omit=dev result of zero vulnerabilities. No secret scanning was performed.

## 11. Performance and Resource Assessment

- F-02: eager image reads and decodes have no aggregate count/byte limit; per-image limits alone do not bound total document memory.
- F-03: search repeats DOM work on each keystroke and on each result navigation.
- Diagrams are sequential and dynamically imported, and the cache is bounded to 24 entries per document. This is a sensible guard against parallel engine pressure.
- KaTeX fonts and PlantUML assets are local; avoiding network fetches is good for predictable rendering.
- VERIFICATION.md documents an uncompressed frontend dist size of 13,184,722 bytes and a Windows NSIS installer of 5,861,034 bytes. These are prior measurements, not refreshed in this audit. Cold-start, process-tree RAM, and diagram peaks remain unmeasured, so further size/runtime optimization should be guided by measurement rather than removing supported engines.

## 12. Testing Assessment

The existing Vitest suite covers URL/image string policies, front matter, math/admonitions/highlighting output, diagram placeholders, and the document read queue. The documented browser smoke covers real DOMPurify and broad user flows, but it is manual and not a CI regression gate.

Highest-value missing coverage:

1. The real final sanitizer policy in a DOM/browser.
2. Rust native path, size, symlink, MIME, and signature checks.
3. Image concurrency and print readiness with many images.
4. Unicode search offset mapping and large-document search responsiveness.

The audit did not run the documented 11-test suite.

## 13. Documentation Assessment

README.md and PLAN.md accurately describe the single-document scope, local-only rendering, supported syntax, error handling, and size/privacy limits. VERIFICATION.md distinguishes documented Windows passes from Linux/macOS and runtime gaps. The docs are unusually specific about recent dependency checks and bundle sizes.

The security statement that the Rust host is a boundary is directionally correct, but it should be revisited after F-01 so it matches the actual Tauri command authority. The three unused-mut warnings are already disclosed in VERIFICATION.md.

## 14. Build, Packaging, Dependencies, and Release Assessment

- package-lock.json and Cargo.lock are committed; frontend packages are pinned exactly and core Tauri crates/plugins use exact versions.
- npm ls --depth=0 found the declared frontend tree installed; npm ls lodash-es --all showed Mermaid/Chevrotain sharing the 4.18.1 override.
- The workflow builds Windows NSIS, Linux deb, and macOS app/dmg artifacts on target OS runners; Linux/macOS results are explicitly unverified in VERIFICATION.md.
- The workflow uses Node 22 and Rust stable rather than exact patch toolchains, so builds are lockfile-based but not fully hermetic.
- Windows artifacts are documented as unsigned; code signing/notarization and installer install/uninstall behavior remain unverified.
- The 5.86 MB compressed Windows installer is modest for a fully offline reader with Mermaid and PlantUML, but it does not measure runtime memory or system WebView size.

## 15. Positive Findings

- The codebase remains narrow in product scope and has clear module ownership.
- Parser and diagram boundaries are explicit; Mermaid/PlantUML interception occurs before syntax highlighting.
- Local image access is substantially narrower than exposing a general filesystem plugin.
- Document and image size caps, UTF-8 validation, path canonicalization, extension checks, and signature checks are implemented in Rust.
- Error handling for malformed front matter/math and diagram failures is localized.
- Dependency locks, manual verification notes, and artifact-size measurements are maintained.
- Tests target security-sensitive parser policies rather than only happy-path UI features.

## 16. Prioritized Remediation Roadmap

### Immediate

- **F-01:** Narrow native document-read authority so a WebView cannot supply an arbitrary local path.

### Short Term

- **F-04:** Add actual sanitizer and native path-policy regression tests.
- **F-02:** Bound image work and avoid loading offscreen assets before they are needed.
- **F-03:** Coalesce search input and profile large/high-match articles.

### Medium Term

- **F-05:** Preserve original Unicode offsets during case-insensitive search.
- **F-08:** Confirm whether the direct lodash-es declaration is needed.

### Optional

- **F-06:** Remove the three unused-mut warnings.
- **F-07:** Remove the stale #app selector.

## 17. Items Requiring Human Verification

- Confirm expected threat model for Markdown from untrusted sources and the desired UX for native file selection before redesigning F-01.
- Profile a realistic document with many large images and high-frequency search terms.
- Confirm whether plantuml-qc.html and fixtures/syntax-showcase.md are still used manually.
- Verify Linux/macOS build/runtime, Windows installer installation/uninstallation, OS print dialog behavior, and signing according to release needs.

## 18. Limitations and Unreviewed Areas

- No tests, type-check, build, dependency audit, Cargo command, or runtime smoke was run in this review.
- Browser/native behavior and platform packaging conclusions rely on the checked-in VERIFICATION.md, not fresh execution.
- Cold-start, memory, and diagram throughput have no current measurements.
- Third-party source internals and binary assets were not reviewed line by line.
- No application source, tests, build configuration, or docs were modified. Only this approved audit report was created.
