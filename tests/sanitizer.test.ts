// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { renderMarkdownDocument, sanitizeRenderedHtml } from '../src/markdown';

describe('production DOMPurify policy', () => {
  it('removes executable HTML, SVG, protocols, and event attributes', () => {
    const sanitized = sanitizeRenderedHtml([
      '<p onclick="alert(1)">safe text</p>',
      '<img src="file:///secret" onerror="alert(1)" data-evil="1">',
      '<svg><script>alert(1)</script><a href="javascript:alert(1)">link</a></svg>',
      '<iframe src="https://example.com"></iframe>',
    ].join(''));

    expect(sanitized).toContain('safe text');
    expect(sanitized).not.toMatch(/onclick|onerror|javascript:|file:|<script|<iframe|data-evil/i);
  });

  it('keeps the attributes required by local rendering', () => {
    const result = renderMarkdownDocument([
      'Inline math $x^2$ stays rendered.',
      '',
      '![diagram](images/diagram.png)',
      '',
      '```mermaid',
      'flowchart LR\n  A --> B',
      '```',
    ].join('\n'));

    expect(result.html).toContain('katex');
    expect(result.html).toContain('<math');
    expect(result.html).toContain('class="local-image"');
    expect(result.html).toContain('data-relative-path="images/diagram.png"');
    expect(result.html).toContain('class="diagram-placeholder"');
    expect(result.html).toContain('data-language="mermaid"');
  });

  it('renders raw HTML as inert text through the full Markdown pipeline', () => {
    const result = renderMarkdownDocument('<img src="x" onerror="alert(1)"><script>alert(1)</script>');
    const container = document.createElement('div');
    container.innerHTML = result.html;

    expect(container.querySelector('img, script')).toBeNull();
    expect(result.html).toContain('&lt;img');
    expect(result.html).toContain('&lt;script&gt;');
  });
});
