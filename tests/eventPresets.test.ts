import { describe, expect, it } from 'vitest';

import { courses, cupState, dataAgeDays, eventPresets, nextCup } from '@/data';
import { GLOBAL_TRACK_IDS } from '@/courses/trackIds';

const cm = eventPresets.championsMeeting;

describe('Champions Meeting presets', () => {
  it('exposes cups and knows where Global has got to', () => {
    expect(cm.available).toBe(true);
    expect(cm.entries.length).toBeGreaterThan(30);
    // The snapshot moves on with every daily refresh, so check consistency, not a fixed cup.
    const released = cm.entries.filter((e) => e.status === 'released-on-global').map((e) => e.id);
    expect(released.length).toBeGreaterThanOrEqual(16);
    expect(cm.highestGlobalId).toBe(Math.max(...released));
    expect(cm.firstUpcomingId).toBe(cm.highestGlobalId + 1);
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

describe('cup state is derived from dates, not just list membership', () => {
  const base = cm.entries.find((e) => e.id === 16)!; // Leo Cup, already run on Global
  const DAY = 86_400;
  const T = 1_800_000_000;

  it('reports a finished cup as completed', () => {
    const finished = { ...base, startsAt: T - 10 * DAY, endsAt: T - 3 * DAY };
    expect(cupState(finished, T)).toBe('completed');
  });

  it('reports a cup that is on right now as running', () => {
    const live = { ...base, startsAt: T - DAY, endsAt: T + DAY };
    expect(cupState(live, T)).toBe('running-now');
  });

  /**
   * The important case: GameTora adds a cup to Global's list when it is ANNOUNCED,
   * so a cup can be in that list with a future start date. Membership alone would
   * wrongly call it "already run".
   */
  it('reports an announced but not yet started cup as announced', () => {
    const announced = { ...base, startsAt: T + 5 * DAY, endsAt: T + 11 * DAY };
    expect(cupState(announced, T)).toBe('announced');
    expect(announced.status).toBe('released-on-global');
  });

  it('reports a cup Global has not scheduled at all as upcoming', () => {
    const predicted = cm.entries.find((e) => e.status === 'upcoming-on-global')!;
    expect(cupState(predicted, T)).toBe('upcoming');
  });

  it('falls back to the snapshot classification before the clock is available', () => {
    expect(cupState(base, null)).toBe('completed');
    const predicted = cm.entries.find((e) => e.status === 'upcoming-on-global')!;
    expect(cupState(predicted, null)).toBe('upcoming');
  });

  it('picks the next unfinished cup, and a finished cup rolls on to the following one', () => {
    const now = Math.floor(Date.now() / 1000);
    const sorted = cm.entries.slice().sort((a, b) => a.id - b.id);
    const next = nextCup(now)!;
    expect(cupState(next, now)).not.toBe('completed');
    // Nothing before it is still open.
    for (const c of sorted) {
      if (c.id < next.id) expect(cupState(c, now)).toBe('completed');
    }

    // Once the next cup has been run, the following listed cup takes its place.
    const following = sorted.find((c) => c.id > next.id)!;
    const after = sorted.find((c) => c.id > next.id && cupState(c, now) !== 'completed')!;
    expect(after.id).toBe(following.id);
  });

  it('reports how stale the underlying snapshot is', () => {
    expect(dataAgeDays(null)).toBeNull();
    const now = Math.floor(Date.now() / 1000);
    const age = dataAgeDays(now)!;
    expect(Number.isFinite(age)).toBe(true);
    expect(age).toBeGreaterThanOrEqual(0);
  });
});
