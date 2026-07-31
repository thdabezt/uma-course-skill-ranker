import { describe, expect, it } from 'vitest';

import { characters, skills } from '@/data';
import { characterUrl, isValidGameToraUrl, isValidUrlName } from '@/data/gametora';

describe('GameTora URL helpers', () => {
  it('accepts a real card slug and rejects anything else', () => {
    expect(isValidUrlName('100101-special-week')).toBe(true);
    expect(isValidUrlName('Special Week')).toBe(false);
    expect(isValidUrlName('')).toBe(false);
    expect(isValidUrlName(undefined)).toBe(false);
    expect(isValidUrlName('bad--slug')).toBe(false);
  });

  it('builds a character URL only from a valid slug', () => {
    expect(characterUrl('100101-special-week')).toBe(
      'https://gametora.com/umamusume/characters/100101-special-week',
    );
    // Never derived from an English display name.
    expect(characterUrl('Special Week')).toBeNull();
    expect(characterUrl(null)).toBeNull();
  });

  it('validates the final URL', () => {
    expect(isValidGameToraUrl('https://gametora.com/umamusume/characters/100101-special-week')).toBe(true);
    expect(isValidGameToraUrl('http://gametora.com/umamusume/characters/x')).toBe(false);
    expect(isValidGameToraUrl('https://evil.example/umamusume/characters/x')).toBe(false);
    expect(isValidGameToraUrl('https://gametora.com/')).toBe(false);
    expect(isValidGameToraUrl('/umamusume/characters/x')).toBe(false);
    expect(isValidGameToraUrl(undefined)).toBe(false);
  });
});

describe('links stored in the normalized data', () => {
  it('gives every Global character a valid canonical page', () => {
    expect(characters.length).toBeGreaterThan(50);
    for (const c of characters) {
      expect(`${c.name}: ${isValidGameToraUrl(c.gameToraUrl)}`).toBe(`${c.name}: true`);
      expect(c.gameToraUrl).toContain('/umamusume/characters/');
    }
  });

  it('never builds a character URL from the display name', () => {
    for (const c of characters) {
      expect(c.gameToraUrl).toContain(String(c.cardId));
    }
  });

  it('only links skills that have a canonical page, and labels the target', () => {
    const linked = skills.filter((s) => s.gameToraUrl);
    expect(linked.length).toBeGreaterThan(0);
    for (const s of linked) {
      expect(isValidGameToraUrl(s.gameToraUrl)).toBe(true);
      // GameTora publishes no per-skill page, so the only valid target is the
      // character card page that owns the unique skill.
      expect(s.gameToraUrlKind).toBe('character');
      // Inheritable copies document the same skill, so they link to the same page.
      expect(['unique', 'unique_upgraded', 'inherited_unique']).toContain(s.rarity);
    }
  });

  it('leaves non-unique skills without a URL rather than guessing one', () => {
    const guessed = skills.filter(
      (s) =>
        s.gameToraUrl &&
        s.rarity !== 'unique' &&
        s.rarity !== 'unique_upgraded' &&
        s.rarity !== 'inherited_unique',
    );
    expect(guessed).toEqual([]);
    expect(skills.some((s) => !s.gameToraUrl)).toBe(true);
  });

  it('points each linked unique skill at a character that actually owns it', () => {
    const urlByCardId = new Map(characters.map((c) => [c.cardId, c.gameToraUrl]));
    for (const s of skills.filter((x) => x.gameToraUrl)) {
      const owners = s.ownerCardIds.map((id) => urlByCardId.get(id)).filter(Boolean);
      expect(owners).toContain(s.gameToraUrl);
    }
  });
});
