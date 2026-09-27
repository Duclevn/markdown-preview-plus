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
    const lower = text.toLocaleLowerCase();
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let index = lower.indexOf(needle, cursor);
    while (index !== -1) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = text.slice(index, index + needle.length);
      fragment.append(mark);
      matches.push(mark);
      cursor = index + needle.length;
      index = lower.indexOf(needle, cursor);
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
  return matches;
}

export function moveSearchMatch(matches: HTMLElement[], current: number, direction: 1 | -1): number {
  if (matches.length === 0) return -1;
  const next = current < 0 ? 0 : (current + direction + matches.length) % matches.length;
  for (const match of matches) {
    match.classList.remove('search-hit-current');
    match.removeAttribute('aria-current');
  }
  matches[next]?.classList.add('search-hit-current');
  matches[next]?.setAttribute('aria-current', 'true');
  matches[next]?.scrollIntoView({ block: 'nearest' });
  return next;
}
