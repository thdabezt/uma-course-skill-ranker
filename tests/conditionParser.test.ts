import { describe, expect, it } from 'vitest';

import { conditionNames, parseCondition } from '@/skills/conditionParser';

describe('condition parser (UI helper)', () => {
  it('splits OR alternatives on @ and AND terms on &', () => {
    const parsed = parseCondition('phase>=2&corner==0@is_finalcorner==1&order<=3');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].terms.map((t) => t.name)).toEqual(['phase', 'corner']);
    expect(parsed[1].terms.map((t) => t.name)).toEqual(['is_finalcorner', 'order']);
    expect(parsed[0].terms[0]).toMatchObject({ name: 'phase', operator: '>=', value: 2 });
  });

  it('ignores malformed terms instead of throwing', () => {
    expect(() => parseCondition('garbage&&==')).not.toThrow();
    expect(parseCondition('')).toEqual([]);
  });

  it('lists every condition name once', () => {
    expect(conditionNames('phase>=2&corner==0@phase>=2&is_finalcorner==1')).toEqual(['phase', 'corner', 'is_finalcorner']);
  });
});
