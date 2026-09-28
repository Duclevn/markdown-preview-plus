// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { clearArticleSearch, findSearchRanges, nextSearchMatchIndex, searchArticle } from '../src/search';

describe('search ranges', () => {
  it('maps matches after a lowercase expansion back to source offsets', () => {
    const text = 'İX';

    expect(findSearchRanges(text, 'x')).toEqual([{ start: 1, end: 2 }]);
  });

  it('maps a match within a lowercase expansion to the source character', () => {
    expect(findSearchRanges('İ', 'i')).toEqual([{ start: 0, end: 1 }]);
  });

  it('uses the requested locale for Turkish casing', () => {
    expect(findSearchRanges('I', 'ı', 'tr')).toEqual([{ start: 0, end: 1 }]);
  });

  it('maps Lithuanian contextual lowercase expansion to source offsets', () => {
    expect(findSearchRanges(`I\u0301X`, 'x', 'lt')).toEqual([{ start: 2, end: 3 }]);
  });

  it('preserves context-sensitive whole-string lowercasing', () => {
    expect(findSearchRanges('ΟΣ', 'ος')).toEqual([{ start: 0, end: 2 }]);
    expect(findSearchRanges('ΟΣ', 'οσ')).toEqual([]);
  });
});

describe('search match navigation', () => {
  it('moves in both directions and wraps at either end', () => {
    expect(nextSearchMatchIndex(3, 0, 1)).toBe(1);
    expect(nextSearchMatchIndex(3, 2, 1)).toBe(0);
    expect(nextSearchMatchIndex(3, 2, -1)).toBe(1);
    expect(nextSearchMatchIndex(3, 0, -1)).toBe(2);
  });

  it('starts at the matching edge for a direction without a current match', () => {
    expect(nextSearchMatchIndex(3, -1, 1)).toBe(0);
    expect(nextSearchMatchIndex(3, -1, -1)).toBe(2);
    expect(nextSearchMatchIndex(0, -1, 1)).toBe(-1);
  });
});

describe('rendered search coverage', () => {
  it('searches rich visible text but skips diagram and hidden content', () => {
    const article = document.createElement('article');
    article.innerHTML = [
      '<h2>Needle heading</h2>',
      '<p>Needle <a href="#">needle link</a></p>',
      '<blockquote>NEEDLE quote</blockquote>',
      '<table><tbody><tr><td>needle table</td></tr></tbody></table>',
      '<pre><code>needle code</code></pre>',
      '<div class="diagram-shell">needle diagram label</div>',
      '<svg><text>needle svg label</text></svg>',
      '<div aria-hidden="true">needle hidden</div>',
    ].join('');

    const matches = searchArticle(article, 'needle');

    expect(matches).toHaveLength(6);
    expect(article.querySelectorAll('mark.search-hit')).toHaveLength(6);
    expect(article.querySelector('.diagram-shell')?.querySelector('mark')).toBeNull();
    expect(article.querySelector('svg')?.querySelector('mark')).toBeNull();
    expect(article.querySelector('[aria-hidden="true"]')?.querySelector('mark')).toBeNull();

    clearArticleSearch(article);
    expect(article.querySelectorAll('mark.search-hit')).toHaveLength(0);
  });
});
