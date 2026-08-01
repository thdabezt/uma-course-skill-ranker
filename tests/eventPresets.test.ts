import { describe, expect, it } from 'vitest';

import { courses, eventPresets } from '@/data';
import { GLOBAL_TRACK_IDS } from '@/courses/trackIds';

const cm = eventPresets.championsMeeting;

describe('Champions Meeting presets', () => {
  it('exposes cups and knows where Global has got to', () => {
    expect(cm.available).toBe(true);
    expect(cm.entries.length).toBeGreaterThan(30);
    expect(cm.highestGlobalId).toBe(16);
    expect(cm.firstUpcomingId).toBe(17);
  });

  it('marks cups Global has already run as released and the rest as upcoming', () => {
    for (const e of cm.entries) {
      const expected = e.id <= cm.highestGlobalId ? 'released-on-global' : 'upcoming-on-global';
      expect(`${e.id}: ${e.status}`).toBe(`${e.id}: ${expected}`);
    }
    expect(cm.entries.filter((e) => e.status === 'upcoming-on-global').length).toBeGreaterThan(20);
  });

  it('resolves every preset to a real Global course with matching geometry', () => {
    for (const e of cm.entries) {
      const course = courses.find((c) => c.id === e.courseId);
      expect(`${e.name}: course found`).toBe(course ? `${e.name}: course found` : `${e.name}: MISSING`);
      expect(course!.trackId).toBe(e.trackId);
      expect(course!.distance).toBe(e.distance);
      expect(course!.surface).toBe(e.surface);
    }
  });

  it('carries a complete, valid race setup for each cup', () => {
    for (const e of cm.entries) {
      expect(['firm', 'good', 'soft', 'heavy']).toContain(e.trackCondition);
      expect(['sunny', 'cloudy', 'rainy', 'snowy']).toContain(e.weather);
      expect(['spring', 'summer', 'autumn', 'winter', 'sakura']).toContain(e.season);
      expect(e.sourceUrl).toContain('champions-meeting?cm=');
    }
  });

  it('gives the next upcoming cup the setup the Japanese server used', () => {
    // Cup 17 = Virgo Cup: Ooi, 2000 m dirt, good ground, autumn.
    const next = cm.entries.find((e) => e.id === 17)!;
    expect(next.name).toBe('Virgo Cup');
    expect(next.trackId).toBe(GLOBAL_TRACK_IDS.OI);
    expect(next.distance).toBe(2000);
    expect(next.surface).toBe('dirt');
    expect(next.trackCondition).toBe('good');
    expect(next.season).toBe('autumn');
  });

  it('translates the zodiac cup names to English', () => {
    for (const e of cm.entries.filter((x) => x.status === 'upcoming-on-global')) {
      expect(`${e.id}: ${/^[\x00-\x7F]+$/.test(e.name)}`).toBe(`${e.id}: true`);
    }
  });

  it('keeps the released cups in step with the Global names', () => {
    const leo = cm.entries.find((e) => e.id === 16)!;
    expect(leo.name).toBe('Leo Cup');
    expect(leo.trackId).toBe(GLOBAL_TRACK_IDS.NAKAYAMA);
    expect(leo.distance).toBe(1200);
  });
});

describe('League of Heroes', () => {
  it('is reported as unavailable rather than invented', () => {
    expect(eventPresets.leagueOfHeroes.available).toBe(false);
    expect(eventPresets.leagueOfHeroes.entries).toEqual([]);
    expect(eventPresets.leagueOfHeroes.reason.length).toBeGreaterThan(20);
    expect(eventPresets.leagueOfHeroes.sourceUrl).toContain('league-of-heroes');
  });
});
