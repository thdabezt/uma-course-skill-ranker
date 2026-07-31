/**
 * Structural audit of the normalized course records.
 *
 * Run automatically by `scripts/build-data.mjs` and standalone via
 * `npm run data:audit`. Reports - it does not silently repair - so that a change
 * in the upstream payload surfaces instead of being papered over.
 */

import { getDistanceCategory } from '../../src/courses/distanceCategory.ts';

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * @param {any[]} courses normalized course records
 * @returns {{issues: {severity: 'error'|'warning', courseId: number, course: string, check: string, detail: string}[], checked: number}}
 */
export function auditCourses(courses) {
  const issues = [];
  const add = (severity, c, check, detail) =>
    issues.push({ severity, courseId: c.id, course: c.name, check, detail });

  const identities = new Map();

  for (const c of courses) {
    /* ---- distance category ------------------------------------------- */
    const expected = getDistanceCategory(c.distance);
    if (c.distanceCategory !== expected) {
      add('error', c, 'distance-category', `stored ${c.distanceCategory}, official band says ${expected}`);
    }
    if (c.upstreamDistanceCategory && c.upstreamDistanceCategory !== expected) {
      add(
        'warning',
        c,
        'upstream-distance-category',
        `GameTora tags ${c.distance} m as ${c.upstreamDistanceCategory}, official band is ${expected} (using the official band)`,
      );
    }

    /* ---- section bounds ---------------------------------------------- */
    const named = [
      ['corner', c.corners],
      ['straight', c.straights],
      ['uphill', c.uphills],
      ['downhill', c.downhills],
      ['phase', c.phases],
    ];
    for (const [kind, list] of named) {
      for (const s of list ?? []) {
        if (!(s.end > s.start)) {
          add('error', c, 'invalid-section', `${kind} ${s.start}-${s.end} m has a non-positive length`);
        }
        if (s.start < 0 || s.end > c.distance) {
          add(
            'error',
            c,
            'section-out-of-range',
            `${kind} ${s.start}-${s.end} m falls outside 0-${c.distance} m`,
          );
        }
      }
    }

    /* ---- overlaps ----------------------------------------------------- */
    for (const [kind, list] of [
      ['corner', c.corners],
      ['straight', c.straights],
      ['uphill', c.uphills],
      ['downhill', c.downhills],
      ['phase', c.phases],
    ]) {
      const sorted = (list ?? []).slice().sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i += 1) {
        if (overlaps(sorted[i - 1], sorted[i])) {
          add(
            'error',
            c,
            'overlapping-sections',
            `two ${kind} sections overlap: ${sorted[i - 1].start}-${sorted[i - 1].end} and ${sorted[i].start}-${sorted[i].end} m`,
          );
        }
      }
    }
    for (const up of c.uphills ?? []) {
      for (const down of c.downhills ?? []) {
        if (overlaps(up, down)) {
          add('error', c, 'overlapping-sections', `uphill and downhill overlap at ${up.start}-${up.end} m`);
        }
      }
    }
    for (const corner of c.corners ?? []) {
      for (const straight of c.straights ?? []) {
        if (overlaps(corner, straight)) {
          add(
            'error',
            c,
            'overlapping-sections',
            `corner ${corner.start}-${corner.end} m overlaps straight ${straight.start}-${straight.end} m`,
          );
        }
      }
    }

    /* ---- phases -------------------------------------------------------- */
    const phases = (c.phases ?? []).slice().sort((a, b) => a.phase - b.phase);
    if (phases.length !== 4 || phases.some((p, i) => p.phase !== i)) {
      add('error', c, 'phase-boundaries', `expected phases 0-3, got [${phases.map((p) => p.phase).join(', ')}]`);
    } else {
      if (phases[0].start !== 0) add('error', c, 'phase-boundaries', `phase 0 starts at ${phases[0].start} m`);
      if (phases[3].end !== c.distance) {
        add('error', c, 'phase-boundaries', `phase 3 ends at ${phases[3].end} m, course is ${c.distance} m`);
      }
      for (let i = 1; i < phases.length; i += 1) {
        if (phases[i].start !== phases[i - 1].end) {
          add(
            'error',
            c,
            'phase-boundaries',
            `gap between phase ${i - 1} (ends ${phases[i - 1].end} m) and phase ${i} (starts ${phases[i].start} m)`,
          );
        }
      }
    }

    /* ---- layout -------------------------------------------------------- */
    if (!c.layout) add('error', c, 'missing-layout', 'no inner/outer course variant recorded');
    if (!['inner', 'outer', 'inner-outer', 'outer-inner', 'standard'].includes(c.layout)) {
      add('error', c, 'invalid-layout', `unknown course variant "${c.layout}"`);
    }
    if (!c.direction) add('error', c, 'missing-layout', 'no track direction recorded');
    if (!c.surface) add('error', c, 'missing-layout', 'no surface recorded');

    /* ---- start / finish geometry ---------------------------------------- */
    if (!(c.finalStraightStart >= 0 && c.finalStraightStart <= c.distance)) {
      add('error', c, 'final-straight', `final straight starts at ${c.finalStraightStart} m`);
    }
    if (c.finalCorner && c.finalCorner.start > c.finalStraightStart) {
      add(
        'error',
        c,
        'final-corner',
        `final corner (${c.finalCorner.start} m) starts after the final straight (${c.finalStraightStart} m)`,
      );
    }
    if (c.corners?.length && !c.finalCorner) {
      add('error', c, 'final-corner', 'course has corners but no final corner was resolved');
    }
    if (c.distance - c.finalStraightStart <= 0) {
      add('error', c, 'final-straight', 'final straight has zero length');
    }
    if (c.spurtStart && (c.spurtStart.meters < 0 || c.spurtStart.meters > c.distance)) {
      add('error', c, 'spurt-start', `last spurt starts at ${c.spurtStart.meters} m, outside the course`);
    }

    /* ---- coverage -------------------------------------------------------- */
    const covered =
      (c.corners ?? []).reduce((a, s) => a + (s.end - s.start), 0) +
      (c.straights ?? []).reduce((a, s) => a + (s.end - s.start), 0);
    if (covered > c.distance + 1) {
      add('error', c, 'section-coverage', `corners + straights cover ${Math.round(covered)} m of a ${c.distance} m course`);
    }
    if (covered < c.distance * 0.5) {
      add(
        'warning',
        c,
        'section-coverage',
        `corners + straights only cover ${Math.round(covered)} m of ${c.distance} m (multi-lap course geometry)`,
      );
    }

    /* ---- duplicate identity ------------------------------------------------ */
    const identity = `${c.trackId}|${c.surface}|${c.distance}|${c.layout}|${c.direction}`;
    if (identities.has(identity)) {
      add(
        'error',
        c,
        'duplicate-identity',
        `same racecourse/surface/distance/variant as course ${identities.get(identity)}`,
      );
    } else {
      identities.set(identity, c.id);
    }
  }

  /* ---- duplicate ids ------------------------------------------------------- */
  const seenIds = new Set();
  for (const c of courses) {
    if (seenIds.has(c.id)) add('error', c, 'duplicate-identity', `course id ${c.id} appears more than once`);
    seenIds.add(c.id);
  }

  return { issues, checked: courses.length };
}

export function formatCourseIssues(issues, limit = 40) {
  const lines = issues
    .slice(0, limit)
    .map((i) => `  [${i.severity}] ${i.course} (${i.courseId}) - ${i.check}: ${i.detail}`);
  if (issues.length > limit) lines.push(`  ... and ${issues.length - limit} more`);
  return lines.join('\n');
}
