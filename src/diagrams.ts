import DOMPurify from 'dompurify';

type DiagramLanguage = 'mermaid' | 'plantuml';
type MermaidEngine = typeof import('mermaid').default;
type PlantUmlEngine = typeof import('@plantuml/core');

interface DiagramJob {
  element: HTMLElement;
  language: DiagramLanguage;
  source: string;
  index: number;
}

declare global {
  interface Window {
    PLANTUML_STDLIB_BASE?: string;
    PLANTUML_THEMES?: Record<string, string>;
  }
}

const maxCacheEntries = 24;
let mermaidPromise: Promise<MermaidEngine> | undefined;
let plantUmlPromise: Promise<PlantUmlEngine> | undefined;
let renderQueue: Promise<void> = Promise.resolve();
let plantUmlTimedOut = false;
const plantUmlTimeoutMs = 45_000;

function remember(cache: Map<string, string>, key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxCacheEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function enqueue<T>(queue: Promise<void>, task: () => Promise<T>): { result: Promise<T>; next: Promise<void> } {
  const result = queue.then(task, task);
  return { result, next: result.then(() => undefined, () => undefined) };
}

function loadClassicScript(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, document.baseURI).href;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Unable to load local PlantUML asset: ${path}`));
    document.head.append(script);
  });
}

function loadMermaid(): Promise<MermaidEngine> {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      htmlLabels: false,
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
      sequence: { useMaxWidth: true },
    });
    return mermaid;
  });
  return mermaidPromise;
}

function loadPlantUml(): Promise<PlantUmlEngine> {
  plantUmlPromise ??= (async () => {
    window.PLANTUML_STDLIB_BASE = new URL('./plantuml/', document.baseURI).href;
    await loadClassicScript('./plantuml/viz-global.js');
    await loadClassicScript('./plantuml/themes.js');
    return import('@plantuml/core');
  })();
  return plantUmlPromise;
}

function renderPlantUml(engine: PlantUmlEngine, source: string): Promise<string> {
  if (plantUmlTimedOut) return Promise.reject(new Error('The PlantUML engine stopped responding. Restart the app before rendering PlantUML again.'));
  let timeout = 0;
  const rendering = new Promise<string>((resolve, reject) => {
    engine.renderToString(source.replace(/\r\n?/g, '\n').split('\n'), resolve, (error) => {
      reject(new Error(typeof error === 'string' ? error : 'PlantUML could not render this diagram.'));
    });
  });
  const deadline = new Promise<string>((_resolve, reject) => {
    timeout = window.setTimeout(() => {
      plantUmlTimedOut = true;
      reject(new Error('The PlantUML engine stopped responding. Restart the app before rendering PlantUML again.'));
    }, plantUmlTimeoutMs);
  });
  return Promise.race([rendering, deadline]).finally(() => window.clearTimeout(timeout));
}

function createDiagramShell(language: DiagramLanguage, source: string): HTMLElement {
  const shell = document.createElement('section');
  shell.className = 'diagram-shell';
  shell.setAttribute('aria-label', `${language === 'mermaid' ? 'Mermaid' : 'PlantUML'} diagram`);

  const caption = document.createElement('div');
  caption.className = 'diagram-caption';
  caption.textContent = language;

  const stage = document.createElement('div');
  stage.className = 'diagram-stage';
  stage.setAttribute('aria-live', 'polite');
  const loading = document.createElement('p');
  loading.className = 'diagram-message';
  loading.textContent = 'Rendering diagram…';
  stage.append(loading);

  const sourceDetails = document.createElement('details');
  sourceDetails.className = 'diagram-source';
  const summary = document.createElement('summary');
  summary.textContent = 'Show original source';
  const sourcePre = document.createElement('pre');
  const sourceCode = document.createElement('code');
  sourceCode.textContent = source;
  sourcePre.append(sourceCode);
  sourceDetails.append(summary, sourcePre);

  shell.append(caption, stage, sourceDetails);
  return shell;
}

function safeSvg(svg: string, namespace: string): string {
  const purified = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onload', 'onclick', 'onerror'],
  }) as DocumentFragment;
  const root = purified.querySelector('svg');
  if (!root) throw new Error('The diagram renderer returned invalid SVG.');

  const ids = new Map<string, string>();
  for (const element of [root, ...root.querySelectorAll<SVGElement>('[id]')]) {
    const id = element.getAttribute('id');
    if (id) ids.set(id, `${namespace}-${id}`);
  }

  const rewriteReferences = (value: string): string => value
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, quote: string, target: string) => {
      const reference = target.trim();
      if (!reference.startsWith('#')) return 'none';
      const replacement = ids.get(reference.slice(1));
      return replacement ? `url(${quote}#${replacement}${quote})` : 'none';
    })
    .replace(/#([\w:.-]+)/g, (match, id: string) => ids.has(id) ? `#${ids.get(id)}` : match);

  for (const element of [root, ...root.querySelectorAll<SVGElement>('*')]) {
    const attributes = Array.from(element.attributes);
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      } else if ((name === 'href' || name === 'xlink:href') && value && !value.startsWith('#')) {
        element.removeAttribute(attribute.name);
      } else if (name === 'style' && /@import/i.test(value)) {
        element.removeAttribute(attribute.name);
      } else if (name === 'style') {
        element.setAttribute(attribute.name, rewriteReferences(value));
      } else if (name === 'id' && ids.has(value)) {
        element.setAttribute(attribute.name, ids.get(value)!);
      } else if (name === 'aria-labelledby' || name === 'aria-describedby') {
        element.setAttribute(attribute.name, value.split(/\s+/).map((id) => ids.get(id) ?? id).join(' '));
      } else if (name === 'href' || name === 'xlink:href' || /url\s*\(/i.test(value)) {
        element.setAttribute(attribute.name, rewriteReferences(value));
      }
    }
    if (element.tagName.toLowerCase() === 'style') {
      if (/@import/i.test(element.textContent ?? '')) {
        element.remove();
      } else {
        element.textContent = rewriteReferences(element.textContent ?? '');
      }
    }
  }

  root.classList.add('diagram-svg');
  return new XMLSerializer().serializeToString(root);
}

function showSvg(job: DiagramJob, svg: string, generation: number): void {
  const stage = job.element.querySelector<HTMLElement>('.diagram-stage');
  if (!stage) return;
  const safe = safeSvg(svg, `mp-${generation}-${job.index}`);
  const template = document.createElement('template');
  template.innerHTML = safe;
  const root = template.content.querySelector('svg');
  if (root) {
    if (job.language === 'plantuml') root.classList.add('plantuml-svg');
    stage.replaceChildren(root);
    job.element.querySelector('.diagram-source')?.remove();
  }
}

function showError(job: DiagramJob): void {
  const stage = job.element.querySelector<HTMLElement>('.diagram-stage');
  if (!stage) return;
  const message = document.createElement('p');
  message.className = 'diagram-message diagram-error';
  message.setAttribute('role', 'alert');
  message.textContent = 'This diagram could not be rendered.';
  stage.replaceChildren(message);
}

async function renderJob(job: DiagramJob, generation: number, isCurrent: () => boolean, cache: Map<string, string>): Promise<void> {
  if (!isCurrent()) return;
  const cacheKey = `${job.language}\0${job.source}`;
  let svg = cache.get(cacheKey);
  if (svg) {
    cache.delete(cacheKey);
    cache.set(cacheKey, svg);
  } else if (job.language === 'mermaid') {
    const engine = await loadMermaid();
    if (!isCurrent()) return;
    const result = await engine.render(`mp-render-${generation}-${job.index}`, job.source);
    svg = result.svg;
    if (isCurrent()) remember(cache, cacheKey, svg);
  } else {
    const engine = await loadPlantUml();
    if (!isCurrent()) return;
    svg = await renderPlantUml(engine, job.source);
    if (isCurrent()) remember(cache, cacheKey, svg);
  }

  if (!isCurrent()) return;
  showSvg(job, svg, generation);
}

export async function renderDiagrams(
  article: HTMLElement,
  generation: number,
  isCurrent: () => boolean,
): Promise<void> {
  const placeholders = Array.from(article.querySelectorAll<HTMLPreElement>('.diagram-placeholder'));
  const jobs: DiagramJob[] = [];
  const cache = new Map<string, string>();

  placeholders.forEach((placeholder, index) => {
    const language = placeholder.dataset.language;
    if (language !== 'mermaid' && language !== 'plantuml') return;
    const source = placeholder.textContent ?? '';
    const shell = createDiagramShell(language, source);
    placeholder.replaceWith(shell);
    jobs.push({ element: shell, language, source, index });
  });

  for (const job of jobs) {
    if (!isCurrent()) return;
    const { result, next } = enqueue(renderQueue, () => renderJob(job, generation, isCurrent, cache));
    renderQueue = next;

    try {
      await result;
    } catch {
      if (isCurrent()) showError(job);
    }
  }
}
