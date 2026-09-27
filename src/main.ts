import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import './katex/katex.css';
import './styles.css';
import { renderDiagrams } from './diagrams';
import { renderMarkdown, safeExternalUrl, safeRelativeImagePath } from './markdown';
import { createLatestSerialQueue } from './read-queue';
import { clearArticleSearch, moveSearchMatch, searchArticle } from './search';

interface MarkdownDocument {
  path: string;
  name: string;
  content: string;
}

interface Readiness {
  imageFailures: number;
}

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing app element: ${id}`);
  return result as T;
}

const appShell = document.querySelector<HTMLElement>('.app-shell')!;
const openButton = element<HTMLButtonElement>('open-button');
const emptyOpenButton = element<HTMLButtonElement>('empty-open-button');
const searchButton = element<HTMLButtonElement>('search-button');
const exportButton = element<HTMLButtonElement>('export-button');
const searchPanel = element<HTMLElement>('search-panel');
const searchInput = element<HTMLInputElement>('search-input');
const searchCount = element<HTMLOutputElement>('search-count');
const searchPrevious = element<HTMLButtonElement>('search-previous');
const searchNext = element<HTMLButtonElement>('search-next');
const searchClose = element<HTMLButtonElement>('search-close');
const tocSidebar = element<HTMLElement>('toc-sidebar');
const tocResizer = element<HTMLDivElement>('toc-resizer');
const tocList = element<HTMLOListElement>('toc-list');
const emptyState = element<HTMLElement>('empty-state');
const readerState = element<HTMLElement>('reader-state');
const emptyDocument = element<HTMLElement>('empty-document');
const readerAlert = element<HTMLElement>('reader-alert');
const readerLayout = element<HTMLElement>('reader-layout');
const readingArea = element<HTMLElement>('reading-area');
const article = element<HTMLElement>('article');
const documentName = element<HTMLElement>('document-name');
const status = element<HTMLElement>('live-status');
const browserOpenInput = element<HTMLInputElement>('browser-open-input');
const shortcutHint = element<HTMLElement>('shortcut-hint');

const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
const hasNativeBridge = Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
shortcutHint.textContent = `${isMac ? '⌘' : 'Ctrl+'}O`;

let currentDocument: MarkdownDocument | undefined;
let currentGeneration = 0;
let openRequest = 0;
let searchMatches: HTMLElement[] = [];
let currentMatch = -1;
let currentReadiness: Promise<Readiness> = Promise.resolve({ imageFailures: 0 });
let statusTimer = 0;
let tocObserver: IntersectionObserver | undefined;
let tocObserverGeneration = 0;
let tocHeadings = new Map<string, HTMLHeadingElement>();
const TOC_MIN_WIDTH = 190;
const TOC_MOBILE_MIN_WIDTH = 150;
const TOC_MAX_WIDTH = 420;
const TOC_RESIZE_STEP = 16;
let tocWidth = 220;
let tocResizePointerId: number | undefined;
const serializeDocumentReads = createLatestSerialQueue();

function setStatus(message: string): void {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  status.hidden = !message;
  if (message) statusTimer = window.setTimeout(() => { status.hidden = true; }, 6500);
}

function setAlert(message: string): void {
  readerAlert.textContent = message;
  readerAlert.hidden = !message;
}

function updateSearchCount(): void {
  searchCount.textContent = searchMatches.length === 0
    ? '0 of 0'
    : `${currentMatch < 0 ? 0 : currentMatch + 1} of ${searchMatches.length}`;
  searchPrevious.disabled = searchMatches.length === 0;
  searchNext.disabled = searchMatches.length === 0;
}

function runSearch(): void {
  searchMatches = searchArticle(article, searchInput.value);
  currentMatch = searchMatches.length > 0 ? moveSearchMatch(searchMatches, -1, 1) : -1;
  updateSearchCount();
}

function closeSearch(restoreFocus: boolean): void {
  searchPanel.hidden = true;
  appShell.classList.remove('search-open');
  searchInput.value = '';
  clearArticleSearch(article);
  searchMatches = [];
  currentMatch = -1;
  updateSearchCount();
  if (restoreFocus) article.focus({ preventScroll: true });
}

function moveMatch(direction: 1 | -1): void {
  currentMatch = moveSearchMatch(searchMatches, currentMatch, direction);
  updateSearchCount();
}

function disconnectTocObserver(): void {
  tocObserver?.disconnect();
  tocObserver = undefined;
  tocObserverGeneration += 1;
}

function setActiveTocLink(id: string): void {
  const links = tocList.querySelectorAll<HTMLAnchorElement>('a.toc-link');
  links.forEach((link) => {
    const isActive = link.dataset.targetId === id;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function scrollToTocHeading(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>('a.toc-link');
  if (!link || !tocList.contains(link)) return;

  const heading = tocHeadings.get(link.dataset.targetId ?? '');
  if (!heading || typeof heading.scrollIntoView !== 'function') return;
  event.preventDefault();
  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildTableOfContents(): void {
  disconnectTocObserver();
  tocList.replaceChildren();
  tocHeadings = new Map();

  const headings = Array.from(article.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'))
    .filter((heading) => heading.id);
  tocHeadings = new Map(headings.map((heading) => [heading.id, heading]));
  const tocAvailable = headings.length > 0;
  tocSidebar.hidden = !tocAvailable;
  tocResizer.hidden = !tocAvailable;

  if (!tocAvailable) return;

  const links = new Map<string, HTMLAnchorElement>();
  headings.forEach((heading) => {
    const item = document.createElement('li');
    item.className = 'toc-item';

    const link = document.createElement('a');
    link.className = 'toc-link';
    link.href = `#${heading.id}`;
    link.dataset.targetId = heading.id;
    link.dataset.level = heading.tagName.slice(1);
    link.textContent = heading.textContent?.trim() || 'Untitled section';
    item.append(link);
    tocList.append(item);
    links.set(heading.id, link);
  });

  setActiveTocLink(headings[0]!.id);

  if (typeof IntersectionObserver === 'undefined') return;
  const observerGeneration = tocObserverGeneration;
  tocObserver = new IntersectionObserver((entries) => {
    if (observerGeneration !== tocObserverGeneration) return;
    const intersecting = entries
      .filter((entry) => entry.isIntersecting && entry.target instanceof HTMLElement && entry.target.id)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    const activeHeading = intersecting[0]?.target;
    if (activeHeading instanceof HTMLElement && links.has(activeHeading.id)) {
      setActiveTocLink(activeHeading.id);
    }
  }, {
    root: readingArea,
    rootMargin: '0px 0px -65% 0px',
    threshold: 0,
  });

  headings.forEach((heading) => tocObserver?.observe(heading));
}

function getTocWidthBounds(): { min: number; max: number } {
  const isCompact = window.matchMedia('(max-width: 690px)').matches;
  const min = isCompact ? TOC_MOBILE_MIN_WIDTH : TOC_MIN_WIDTH;
  const availableWidth = readerLayout.clientWidth || window.innerWidth;
  const mainMinimum = isCompact ? 170 : 230;
  const max = Math.min(TOC_MAX_WIDTH, Math.max(min, Math.floor(availableWidth - mainMinimum)));
  return { min, max };
}

function clampTocWidth(width: number): number {
  const { min, max } = getTocWidthBounds();
  return Math.min(max, Math.max(min, Math.round(width)));
}

function setTocWidth(width: number): void {
  const { min, max } = getTocWidthBounds();
  tocWidth = clampTocWidth(width);
  readerLayout.style.setProperty('--toc-width', `${tocWidth}px`);
  tocResizer.setAttribute('aria-valuemin', String(min));
  tocResizer.setAttribute('aria-valuemax', String(max));
  tocResizer.setAttribute('aria-valuenow', String(tocWidth));
  tocResizer.setAttribute('aria-valuetext', `${tocWidth} pixels`);
}

function moveTocResizer(event: PointerEvent): void {
  if (tocResizePointerId !== event.pointerId) return;
  const layoutBounds = readerLayout.getBoundingClientRect();
  setTocWidth(event.clientX - layoutBounds.left);
}

function stopTocResize(pointerId?: number): void {
  if (pointerId !== undefined && tocResizePointerId !== pointerId) return;
  tocResizePointerId = undefined;
  document.body.classList.remove('is-resizing-toc');
}

function startTocResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  tocResizePointerId = event.pointerId;
  tocResizer.setPointerCapture(event.pointerId);
  document.body.classList.add('is-resizing-toc');
}

function keyboardResizeToc(event: KeyboardEvent): void {
  const { min, max } = getTocWidthBounds();
  let nextWidth: number | undefined;
  if (event.key === 'ArrowLeft') nextWidth = tocWidth - TOC_RESIZE_STEP;
  else if (event.key === 'ArrowRight') nextWidth = tocWidth + TOC_RESIZE_STEP;
  else if (event.key === 'Home') nextWidth = min;
  else if (event.key === 'End') nextWidth = max;
  if (nextWidth === undefined) return;
  event.preventDefault();
  setTocWidth(nextWidth);
}

function showDocument(doc: MarkdownDocument): void {
  const safeHtml = renderMarkdown(doc.content);
  const generation = ++currentGeneration;
  currentDocument = doc;
  closeSearch(false);
  setAlert('');
  setStatus('');

  documentName.textContent = doc.name;
  document.title = `${doc.name} — Markdown Preview Plus`;
  if (hasNativeBridge) void getCurrentWindow().setTitle(document.title).catch(() => undefined);
  emptyState.hidden = true;
  readerState.hidden = false;
  emptyDocument.hidden = doc.content.trim().length !== 0;
  article.hidden = doc.content.trim().length === 0;
  article.innerHTML = safeHtml;
  buildTableOfContents();
  readingArea.scrollTo(0, 0);
  readerState.setAttribute('aria-busy', 'false');
  searchButton.disabled = false;
  exportButton.disabled = false;

  currentReadiness = new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== currentGeneration) {
        resolve({ imageFailures: 0 });
        return;
      }
      readerState.setAttribute('aria-busy', 'true');
      const imageTask = loadLocalImages(doc, generation);
      const diagramTask = renderDiagrams(article, generation, () => generation === currentGeneration);
      void Promise.all([imageTask, diagramTask]).then(([imageFailures]) => {
        if (generation === currentGeneration) readerState.setAttribute('aria-busy', 'false');
        resolve({ imageFailures });
      });
    }));
  });
}

function unavailableImage(img: HTMLImageElement): void {
  const message = document.createElement('span');
  message.className = 'image-unavailable';
  message.setAttribute('role', 'img');
  message.setAttribute('aria-label', img.alt || 'Local image unavailable');
  message.textContent = img.alt || 'Local image unavailable';
  img.replaceWith(message);
}

async function loadLocalImages(doc: MarkdownDocument, generation: number): Promise<number> {
  let failures = article.querySelectorAll('.image-unavailable').length;
  const images = Array.from(article.querySelectorAll<HTMLImageElement>('img.local-image[data-relative-path]'));

  await Promise.all(images.map(async (img) => {
    const relativePath = safeRelativeImagePath(img.dataset.relativePath ?? '');
    if (!relativePath || !hasNativeBridge) {
      if (generation === currentGeneration) unavailableImage(img);
      failures += 1;
      return;
    }

    try {
      const dataUrl = await invoke<string>('read_local_image', { documentPath: doc.path, relativePath });
      if (generation !== currentGeneration) return;
      if (!/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(dataUrl)) {
        throw new Error('The local image response was not a supported raster image.');
      }
      await new Promise<void>((resolve, reject) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => reject(new Error('The local image could not be decoded.')), { once: true });
        img.src = dataUrl;
        if (img.complete) {
          if (img.naturalWidth > 0) resolve();
          else reject(new Error('The local image could not be decoded.'));
        }
      });
    } catch {
      if (generation === currentGeneration) unavailableImage(img);
      failures += 1;
    }
  }));

  return failures;
}

function isMarkdownName(name: string): boolean {
  return /\.(?:md|markdown)$/i.test(name);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, '');
  return String(error);
}

async function readNativeDocument(path: string, request: number): Promise<MarkdownDocument | undefined> {
  const doc = await serializeDocumentReads(
    () => request === openRequest,
    () => invoke<MarkdownDocument>('read_document', { path }),
  );
  if (request !== openRequest) return undefined;
  if (!doc || typeof doc.path !== 'string' || typeof doc.name !== 'string' || typeof doc.content !== 'string') {
    throw new Error('The native reader returned an invalid document.');
  }
  return doc;
}

async function loadPath(path: string): Promise<void> {
  const request = ++openRequest;
  try {
    const doc = await readNativeDocument(path, request);
    if (request !== openRequest || !doc) return;
    showDocument(doc);
  } catch (error) {
    if (request === openRequest) setAlert(`Could not open this file. Choose a readable .md or .markdown file. ${errorMessage(error)}`);
  }
}

async function chooseFile(): Promise<void> {
  if (!hasNativeBridge) {
    if (import.meta.env.DEV) {
      browserOpenInput.value = '';
      browserOpenInput.click();
    } else {
      setAlert('Open File is available in the desktop app.');
    }
    return;
  }

  try {
    const selected = await open({
      title: 'Open a Markdown file',
      multiple: false,
      directory: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (typeof selected === 'string') await loadPath(selected);
  } catch (error) {
    setAlert(`Could not open the file picker. ${errorMessage(error)}`);
  }
}

browserOpenInput.addEventListener('change', () => {
  const file = browserOpenInput.files?.[0];
  if (!file) return;
  const request = ++openRequest;
  if (!isMarkdownName(file.name)) {
    setAlert('Choose a Markdown file with a .md or .markdown extension.');
    return;
  }
  void file.text().then((content) => {
    if (request !== openRequest) return;
    showDocument({ path: file.name, name: file.name, content });
  }).catch((error: unknown) => {
    if (request === openRequest) setAlert(`Could not read this file. ${errorMessage(error)}`);
  });
});

function openSearch(): void {
  if (!currentDocument) return;
  searchPanel.hidden = false;
  appShell.classList.add('search-open');
  searchInput.focus();
  searchInput.select();
}

function waitForPrintClose(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, 1200);
    window.addEventListener('afterprint', finish, { once: true });
  });
}

async function exportPdf(): Promise<void> {
  if (!currentDocument || exportButton.disabled) return;
  const generation = currentGeneration;
  const label = exportButton.querySelector('span');
  exportButton.disabled = true;
  if (label) label.textContent = 'Preparing…';
  setStatus('Preparing diagrams and local images for printing…');

  try {
    const readiness = await currentReadiness;
    if (generation !== currentGeneration) return;
    if (readiness.imageFailures > 0) {
      setStatus('Some local images could not be loaded. The printout will show placeholders; check that image paths are relative to the Markdown file.');
    }
    const query = searchInput.value;
    clearArticleSearch(article);
    const printClosed = waitForPrintClose();
    window.print();
    await printClosed;
    if (generation === currentGeneration) {
      if (query && !searchPanel.hidden) runSearch();
      setStatus('Use Save as PDF in the system print dialog. Saving or canceling is handled there.');
    }
  } catch (error) {
    if (generation === currentGeneration) setAlert(`Could not prepare the document for printing. ${errorMessage(error)}`);
  } finally {
    exportButton.disabled = !currentDocument;
    const currentLabel = exportButton.querySelector('span');
    if (currentLabel) currentLabel.textContent = 'Export PDF';
  }
}

openButton.addEventListener('click', () => { void chooseFile(); });
emptyOpenButton.addEventListener('click', () => { void chooseFile(); });
searchButton.addEventListener('click', openSearch);
searchInput.addEventListener('input', runSearch);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSearch(true);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    moveMatch(event.shiftKey ? -1 : 1);
  }
});
searchPrevious.addEventListener('click', () => moveMatch(-1));
searchNext.addEventListener('click', () => moveMatch(1));
searchClose.addEventListener('click', () => closeSearch(true));
tocList.addEventListener('click', scrollToTocHeading);
tocResizer.addEventListener('pointerdown', startTocResize);
tocResizer.addEventListener('pointermove', moveTocResizer);
tocResizer.addEventListener('pointerup', (event) => stopTocResize(event.pointerId));
tocResizer.addEventListener('pointercancel', (event) => stopTocResize(event.pointerId));
tocResizer.addEventListener('lostpointercapture', () => stopTocResize());
tocResizer.addEventListener('keydown', keyboardResizeToc);
exportButton.addEventListener('click', () => { void exportPdf(); });
window.addEventListener('resize', () => setTocWidth(tocWidth));

setTocWidth(tocWidth);

article.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>('a.external-link');
  if (!link) return;
  event.preventDefault();
  const url = safeExternalUrl(link.getAttribute('href') ?? '');
  if (!url) return;
  if (!hasNativeBridge) {
    setStatus('External links open from the desktop app.');
    return;
  }
  void openUrl(url).catch((error: unknown) => setStatus(`Could not open this link. ${errorMessage(error)}`));
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !searchPanel.hidden) {
    event.preventDefault();
    closeSearch(true);
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'o') {
    event.preventDefault();
    void chooseFile();
  } else if (key === 'f' && currentDocument) {
    event.preventDefault();
    openSearch();
  } else if (key === 'p' && currentDocument) {
    event.preventDefault();
    void exportPdf();
  }
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

async function initializeNativeEvents(): Promise<void> {
  if (!hasNativeBridge) return;

  try {
    await listen<string[]>('open-files', ({ payload }) => {
      appShell.classList.remove('is-dropping');
      if (payload.length !== 1) {
        setAlert('Open one Markdown file at a time.');
        return;
      }
      void loadPath(payload[0]!);
    });
    const paths = await invoke<string[]>('take_pending_paths');
    if (paths.length > 1) setAlert('Open one Markdown file at a time.');
    else if (paths[0]) void loadPath(paths[0]);
  } catch (error) {
    setAlert(`Could not receive the file that was opened. ${errorMessage(error)}`);
  }

  try {
    await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'enter' || payload.type === 'over') {
        appShell.classList.add('is-dropping');
      } else if (payload.type === 'leave') {
        appShell.classList.remove('is-dropping');
      } else if (payload.type === 'drop') {
        appShell.classList.remove('is-dropping');
        if (payload.paths.length !== 1) {
          setAlert('Drop one Markdown file at a time.');
          return;
        }
        void loadPath(payload.paths[0]!);
      }
    });
  } catch {
    // File drop is unavailable on this platform or webview version.
  }
}

void initializeNativeEvents();
