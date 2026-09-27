import DOMPurify from 'dompurify';
import { CORE_SCHEMA, load as loadYaml } from 'js-yaml';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked, Renderer, type MarkedExtension, type RendererThis, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import markedKatex from 'marked-katex-extension';

const allowedImageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

const curatedHighlightLanguages = {
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  rust,
  typescript,
  xml,
  yaml,
};

const highlightLanguageAliases: Record<string, string> = {
  bash: 'bash',
  shell: 'bash',
  sh: 'bash',
  css: 'css',
  javascript: 'javascript',
  js: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  python: 'python',
  py: 'python',
  rust: 'rust',
  rs: 'rust',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'xml',
};

Object.entries(curatedHighlightLanguages).forEach(([name, definition]) => {
  hljs.registerLanguage(name, definition);
});
Object.entries(highlightLanguageAliases).forEach(([alias, languageName]) => {
  if (alias !== languageName) hljs.registerAliases(alias, { languageName });
});

const supportedAdmonitionTypes = new Set(['note', 'tip', 'warning', 'danger']);
const admonitionLabels: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
};

export type MarkdownMetadata = Record<string, unknown>;

export interface FrontMatterResult {
  body: string;
  metadata: MarkdownMetadata;
  error?: string;
}

export interface MarkdownRenderResult {
  html: string;
  metadata: MarkdownMetadata;
  frontMatterError?: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function safeExternalUrl(value: string): string | null {
  const normalized = value.trim();
  if (!/^https?:\/\//i.test(normalized)) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function safeRelativeImagePath(value: string): string | null {
  const path = value.trim().replaceAll('\\', '/');
  if (!path || path.startsWith('/') || path.includes('\0') || /[?#]/.test(path)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || /^[a-z]:/i.test(path)) return null;

  const segments = path.split('/').filter((segment) => segment && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null;

  const extension = segments.at(-1)?.split('.').at(-1)?.toLowerCase();
  if (!extension || !allowedImageExtensions.has(extension)) return null;
  return segments.join('/');
}

function safeTitle(title: string | null | undefined): string {
  return title ? ` title="${escapeHtml(title)}"` : '';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeMetadataValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeMetadataValue);
  if (!isPlainRecord(value)) throw new Error('Front matter values must use plain YAML objects and arrays.');

  const result: MarkdownMetadata = {};
  Object.entries(value).forEach(([key, nestedValue]) => {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: normalizeMetadataValue(nestedValue),
      writable: true,
    });
  });
  return result;
}

function normalizeMetadata(value: unknown): MarkdownMetadata {
  if (value === null) return {};
  if (!isPlainRecord(value)) throw new Error('Front matter must be a YAML mapping.');
  return normalizeMetadataValue(value) as MarkdownMetadata;
}

const frontMatterPattern = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n|^)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;

export function extractFrontMatter(source: string): FrontMatterResult {
  const match = source.match(frontMatterPattern);
  if (!match || match.index !== 0) return { body: source, metadata: {} };

  try {
    const metadata = normalizeMetadata(loadYaml(match[1] ?? '', {
      maxAliases: 0,
      maxDepth: 20,
      maxTotalMergeKeys: 0,
      schema: CORE_SCHEMA,
    }));
    return { body: source.slice(match[0].length), metadata };
  } catch {
    return {
      body: source.slice(match[0].length),
      metadata: {},
      error: 'Front matter could not be parsed; the document body was rendered without metadata.',
    };
  }
}

function highlightedCode(text: string, language: string): string | null {
  const languageName = highlightLanguageAliases[language];
  if (!languageName) return null;
  try {
    return hljs.highlight(text, { language: languageName, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

function findAdmonitionClosing(source: string): { index: number; length: number } | undefined {
  const lines = source.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g);
  let fence: { marker: '`' | '~'; length: number } | undefined;

  for (const lineMatch of lines) {
    const raw = lineMatch[0];
    if (!raw) break;
    const line = raw.replace(/\r?\n$/, '');

    if (fence) {
      const closingFence = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (closingFence?.[1]?.startsWith(fence.marker) && closingFence[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (openingFence?.[1]) {
      fence = {
        marker: openingFence[1][0] as '`' | '~',
        length: openingFence[1].length,
      };
      continue;
    }

    if (/^ {0,3}:::[ \t]*$/.test(line)) {
      return { index: lineMatch.index, length: raw.length };
    }
  }

  return undefined;
}

function createAdmonitionExtension(): MarkedExtension {
  return {
    extensions: [{
      name: 'admonition',
      level: 'block',
      start(source) {
        const match = source.match(/^ {0,3}:::[A-Za-z][\w-]*[ \t]*\r?\n/m);
        return match?.index;
      },
      tokenizer(source) {
        const opening = source.match(/^ {0,3}:::([A-Za-z][\w-]*)[ \t]*\r?\n/);
        if (!opening) return undefined;
        const rest = source.slice(opening[0].length);
        const closing = findAdmonitionClosing(rest);
        if (!closing) return undefined;
        const rawLength = opening[0].length + closing.index + closing.length;
        return {
          type: 'admonition',
          raw: source.slice(0, rawLength),
          admonitionType: (opening[1] ?? '').toLowerCase(),
          tokens: this.lexer.blockTokens(rest.slice(0, closing.index)),
        };
      },
      childTokens: ['tokens'],
      renderer(this: RendererThis, token: Tokens.Generic) {
        const type = typeof token.admonitionType === 'string' ? token.admonitionType : '';
        if (!supportedAdmonitionTypes.has(type)) {
          return '<div class="admonition admonition-unknown">' +
            '<p class="admonition-title">Unsupported admonition type</p>' +
            `<pre class="admonition-source"><code>${escapeHtml(String(token.raw ?? ''))}</code></pre>` +
            '</div>\n';
        }

        const content = this.parser.parse(token.tokens ?? []);
        return `<div class="admonition admonition-${type}">` +
          `<p class="admonition-title">${admonitionLabels[type]}</p>` +
          content +
          '</div>\n';
      },
    }],
  };
}

function createMathExtension(): MarkedExtension {
  const baseExtension = markedKatex({
    maxExpand: 1000,
    maxSize: 500,
    strict: 'error',
    throwOnError: false,
    trust: false,
  });
  const extensions = (baseExtension.extensions ?? []).map((extension) => {
    if (!('renderer' in extension) || typeof extension.renderer !== 'function') return extension;
    const originalRenderer = extension.renderer;
    return {
      ...extension,
      renderer(this: RendererThis, token: Tokens.Generic) {
        try {
          return originalRenderer.call(this, token);
        } catch {
          const raw = escapeHtml(String(token.raw ?? token.text ?? ''));
          const isBlock = Boolean(token.displayMode);
          return isBlock
            ? `<div class="math-error math-error-block" role="img" aria-label="Math could not be rendered"><code>${raw}</code></div>\n`
            : `<span class="math-error" role="img" aria-label="Math could not be rendered"><code>${raw}</code></span>`;
        }
      },
    } as TokenizerAndRendererExtension;
  });
  return { extensions };
}

function createRenderer(): Renderer {
  const renderer = new Renderer();
  const headingIds = new Map<string, number>();

  renderer.heading = function (this: Renderer, { depth, text, tokens }) {
    const content = this.parser.parseInline(tokens);
    const base = text.normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'section';
    const occurrence = (headingIds.get(base) ?? 0) + 1;
    headingIds.set(base, occurrence);
    const id = occurrence === 1 ? base : `${base}-${occurrence}`;
    return `<h${depth} id="${escapeHtml(id)}">${content}</h${depth}>`;
  };

  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function (this: Renderer, { href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const safeUrl = safeExternalUrl(href);
    if (href.trim().startsWith('#')) {
      return `<a href="${escapeHtml(href)}"${safeTitle(title)}>${text}</a>`;
    }
    if (!safeUrl) return `<span class="disabled-link">${text}</span>`;
    return `<a class="external-link" href="${escapeHtml(safeUrl)}"${safeTitle(title)}>${text}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const safePath = safeRelativeImagePath(href);
    const alt = escapeHtml(text);
    if (!safePath) {
      const label = alt || 'Local image unavailable';
      return `<span class="image-unavailable" role="img" aria-label="${label}">${label}</span>`;
    }
    return `<img class="local-image" data-relative-path="${escapeHtml(safePath)}" alt="${alt}"${safeTitle(title)}>`;
  };
  renderer.code = ({ text, lang }) => {
    const language = lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    if (language === 'mermaid' || language === 'plantuml') {
      return `<pre class="diagram-placeholder" data-language="${language}"><code>${escapeHtml(text)}</code></pre>\n`;
    }
    const languageClassName = /^[a-z\d_-]+$/.test(language) ? `language-${language}` : '';
    const highlighted = highlightedCode(text, language);
    const codeClass = highlighted ? `${languageClassName} hljs`.trim() : languageClassName;
    const classAttribute = codeClass ? ` class="${escapeHtml(codeClass)}"` : '';
    return `<pre><code${classAttribute}>${highlighted ?? escapeHtml(text)}</code></pre>\n`;
  };

  return renderer;
}

const purifierOptions: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ADD_TAGS: ['annotation', 'semantics'],
  ADD_ATTR: [
    'aria-hidden',
    'aria-label',
    'data-language',
    'data-relative-path',
    'display',
    'encoding',
    'mathvariant',
    'preserveAspectRatio',
    'style',
    'viewBox',
    'xmlns',
  ],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'base', 'meta', 'link'],
  FORBID_ATTR: ['src', 'srcset', 'formaction'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

export function renderMarkdownDocument(source: string): MarkdownRenderResult {
  const frontMatter = extractFrontMatter(source);
  const markdown = new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: createRenderer(),
  }, createMathExtension(), createAdmonitionExtension());
  const rendered = markdown.parse(frontMatter.body) as string;
  const error = frontMatter.error
    ? `<div class="front-matter-error" role="status">${escapeHtml(frontMatter.error)}</div>\n`
    : '';
  return {
    html: sanitizeRenderedHtml(error + rendered),
    metadata: frontMatter.metadata,
    frontMatterError: frontMatter.error,
  };
}

export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, purifierOptions);
}

export function renderMarkdown(source: string): string {
  return renderMarkdownDocument(source).html;
}
