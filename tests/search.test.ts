import { describe, expect, it } from 'vitest';

import { findSearchRanges } from '../src/search';

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
