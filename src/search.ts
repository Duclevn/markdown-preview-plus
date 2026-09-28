export function clearArticleSearch(article: HTMLElement): void {
  for (const mark of article.querySelectorAll('mark.search-hit')) {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
  }
  article.normalize();
}

function isSearchableText(node: Node): boolean {
  let parent = node.parentElement;
  while (parent && parent.tagName !== 'ARTICLE') {
    if (parent.matches('svg, .diagram-shell, script, style, [aria-hidden="true"]')) return false;
    parent = parent.parentElement;
  }
  return Boolean(node.textContent);
}

interface SearchRange {
  start: number;
  end: number;
}

interface LowercaseTextMap {
  text: string;
  sourceStarts: number[];
  sourceEnds: number[];
}

type LowercaseLocales = string | string[] | undefined;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function lowercaseWithSourceMap(text: string, locales?: LowercaseLocales): LowercaseTextMap {
  const lowercaseText = text.toLocaleLowerCase(locales);
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];

  for (const { index: sourceStart, segment } of graphemeSegmenter.segment(text)) {
    const sourceEnd = sourceStart + segment.length;
    const lowercaseSegment = segment.toLocaleLowerCase(locales);
    for (let offset = 0; offset < lowercaseSegment.length; offset += 1) {
      sourceStarts.push(sourceStart);
      sourceEnds.push(sourceEnd);
    }
  }

  return { text: lowercaseText, sourceStarts, sourceEnds };
}

function findSearchRangesWithNeedle(text: string, needle: string, locales?: LowercaseLocales): SearchRange[] {
  if (!needle) return [];

  const lowercase = lowercaseWithSourceMap(text, locales);
  const ranges: SearchRange[] = [];
  let cursor = 0;
  let index = lowercase.text.indexOf(needle, cursor);
  while (index !== -1) {
    const matchEnd = index + needle.length - 1;
    const start = lowercase.sourceStarts[index];
    const end = lowercase.sourceEnds[matchEnd];
    if (start === undefined || end === undefined) break;
    ranges.push({ start, end });
    cursor = index + needle.length;
    index = lowercase.text.indexOf(needle, cursor);
  }
  return ranges;
}

export function findSearchRanges(text: string, query: string, locales?: LowercaseLocales): SearchRange[] {
  return findSearchRangesWithNeedle(text, query.trim().toLocaleLowerCase(locales), locales);
}

export function nextSearchMatchIndex(matchCount: number, current: number, direction: 1 | -1): number {
  if (matchCount <= 0) return -1;
  if (current < 0) return direction === -1 ? matchCount - 1 : 0;
  return (current + direction + matchCount) % matchCount;
}

export function searchArticle(article: HTMLElement, query: string): HTMLElement[] {
  clearArticleSearch(article);
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isSearchableText(node) && node.textContent?.toLocaleLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  const matches: HTMLElement[] = [];
  for (const node of textNodes) {
    const text = node.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const { start, end } of findSearchRangesWithNeedle(text, needle)) {
      fragment.append(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = text.slice(start, end);
      fragment.append(mark);
      matches.push(mark);
      cursor = end;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
  return matches;
}

export function moveSearchMatch(matches: HTMLElement[], current: number, direction: 1 | -1): number {
  if (matches.length === 0) return -1;
  const next = nextSearchMatchIndex(matches.length, current, direction);
  for (const match of matches) {
    match.classList.remove('search-hit-current');
    match.removeAttribute('aria-current');
  }
  matches[next]?.classList.add('search-hit-current');
  matches[next]?.setAttribute('aria-current', 'true');
  return next;
}
