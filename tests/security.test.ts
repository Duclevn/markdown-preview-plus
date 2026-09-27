import { describe, expect, it, vi } from 'vitest';

vi.mock('dompurify', () => ({
  default: {
    sanitize: (html: string) => html,
  },
}));

import { escapeHtml, extractFrontMatter, renderMarkdownDocument, safeExternalUrl, safeRelativeImagePath } from '../src/markdown';
import { createLatestSerialQueue } from '../src/read-queue';

describe('Markdown URL policy', () => {
  it('allows only explicit HTTP and HTTPS links without embedded credentials', () => {
    expect(safeExternalUrl('https://example.com/notes?q=1')).toBe('https://example.com/notes?q=1');
    expect(safeExternalUrl('HTTP://example.com')).toBe('http://example.com/');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('file:///Users/me/secret.md')).toBeNull();
    expect(safeExternalUrl('//example.com/image.png')).toBeNull();
    expect(safeExternalUrl('https://user:password@example.com')).toBeNull();
  });

  it('accepts raster images relative to the Markdown file only', () => {
    expect(safeRelativeImagePath('./images/tea cup.png')).toBe('images/tea cup.png');
    expect(safeRelativeImagePath('..\\shared\\diagram.webp')).toBeNull();
    expect(safeRelativeImagePath('photos\\café.jpg')).toBe('photos/café.jpg');
    expect(safeRelativeImagePath('/etc/passwd.png')).toBeNull();
    expect(safeRelativeImagePath('C:\\Users\\me\\secret.png')).toBeNull();
    expect(safeRelativeImagePath('https://example.com/picture.png')).toBeNull();
    expect(safeRelativeImagePath('diagram.svg')).toBeNull();
    expect(safeRelativeImagePath('picture.png?raw=1')).toBeNull();
  });

  it('escapes HTML in generated text and attributes', () => {
    expect(escapeHtml(`<img src="https://example.com" onerror='run()'>`))
      .toBe('&lt;img src=&quot;https://example.com&quot; onerror=&#39;run()&#39;&gt;');
  });
});

describe('rich Markdown extensions', () => {
  it('extracts leading YAML front matter without changing the document title', () => {
    const result = extractFrontMatter([
      '---',
      'title: Hidden metadata title',
      'tags:',
      '  - reader',
      '---',
      '# Filename remains the title',
    ].join('\n'));

    expect(result.metadata).toEqual({ title: 'Hidden metadata title', tags: ['reader'] });
    expect(result.body).toBe('# Filename remains the title');
    expect(result.error).toBeUndefined();
  });

  it('recognizes an empty leading front matter block without matching inline delimiters', () => {
    expect(extractFrontMatter('---\n---\n# Body').body).toBe('# Body');
    expect(extractFrontMatter('---\ntext---\n# Body').body).toContain('text---');
    const nonLeading = '# Before\n---\ntitle: ordinary content\n---\n# After';
    expect(extractFrontMatter(nonLeading)).toEqual({ body: nonLeading, metadata: {} });
  });

  it('renders math, supported and unknown admonitions, curated highlighting, and diagrams together', () => {
    const result = renderMarkdownDocument([
      'Inline math $x^2$.',
      '',
      '$$',
      'x^2 + y^2 = z^2',
      '$$',
      '',
      ':::note',
      'Searchable note text.',
      ':::',
      '',
      ':::tip',
      'A helpful tip.',
      ':::',
      '',
      ':::warning',
      'A warning.',
      ':::',
      '',
      ':::danger',
      'A danger.',
      ':::',
      '',
      ':::future',
      'Unknown content remains visible.',
      ':::',
      '',
      '```js',
      'const answer = true;',
      '```',
      '',
      '```mermaid',
      'flowchart LR\n  A --> B',
      '```',
    ].join('\n'));

    expect(result.html).toContain('katex');
    expect(result.html).toContain('admonition-note');
    expect(result.html).toContain('admonition-tip');
    expect(result.html).toContain('admonition-warning');
    expect(result.html).toContain('admonition-danger');
    expect(result.html).toContain('Unsupported admonition type');
    expect(result.html).toContain('Unknown content remains visible.');
    expect(result.html).toContain('hljs-keyword');
    expect(result.html).toContain('diagram-placeholder');
    expect(result.html).toContain('data-language="mermaid"');
  });

  it('keeps invalid front matter and malformed math local to their content', () => {
    const frontMatterResult = renderMarkdownDocument([
      '---',
      'title: [not closed',
      '---',
      '# Body still renders',
    ].join('\n'));
    const mathResult = renderMarkdownDocument('Before $\\htmlClass{unsafe}{x}$ after.\n\nFollowing paragraph.');

    expect(frontMatterResult.frontMatterError).toBeDefined();
    expect(frontMatterResult.html).toContain('front-matter-error');
    expect(frontMatterResult.html).toContain('Body still renders');
    expect(frontMatterResult.html).not.toContain('title: [not closed');
    expect(mathResult.html).toContain('katex-error');
    expect(mathResult.html).toContain('Following paragraph.');
  });

  it('leaves languages outside the curated set as escaped plain code', () => {
    const result = renderMarkdownDocument([
      '```brainfuck',
      '<not-an-element>',
      '```',
    ].join('\n'));

    expect(result.html).toContain('&lt;not-an-element&gt;');
    expect(result.html).not.toContain('hljs-');
  });

  it('does not close an admonition on a marker inside fenced code', () => {
    const result = renderMarkdownDocument([
      ':::note',
      '```text',
      ':::',
      '```',
      'After the fenced marker.',
      ':::',
      '',
      'Following paragraph.',
    ].join('\n'));

    expect(result.html).toContain('admonition-note');
    expect(result.html).toContain('<code class="language-text">:::</code>');
    expect(result.html).toContain('After the fenced marker.');
    expect(result.html).toContain('Following paragraph.');
  });
});

describe('native document read queue', () => {
  it('keeps the newest completed open authorized when earlier reads finish slowly', async () => {
    const enqueue = createLatestSerialQueue();
    let request = 1;
    let authorizedPath = '';
    let markStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { markStarted = resolve; });

    const first = enqueue(
      () => request === 1,
      async () => {
        markStarted?.();
        await new Promise((resolve) => setTimeout(resolve, 25));
        authorizedPath = 'A.md';
        return 'A.md';
      },
    );
    await firstStarted;

    request = 2;
    const second = enqueue(
      () => request === 2,
      async () => {
        authorizedPath = 'B.md';
        return 'B.md';
      },
    );

    await Promise.all([first, second]);
    expect(authorizedPath).toBe('B.md');
  });

  it('skips an obsolete read that has not started yet', async () => {
    const enqueue = createLatestSerialQueue();
    let request = 1;
    let calls = 0;
    const result = enqueue(() => request === 1, async () => { calls += 1; return 'A.md'; });
    request = 2;
    expect(await result).toBeUndefined();
    expect(calls).toBe(0);
  });
});
