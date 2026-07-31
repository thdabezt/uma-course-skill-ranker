'use client';

import { useId, useMemo, useState } from 'react';

import { sectionLength } from '@/courses/sections';
import { DISTANCE_CATEGORY_LABELS } from '@/courses/distanceCategory';
import type { Course, Section } from '@/simulation/types';

/**
 * Data-driven, responsive SVG diagram of a racecourse.
 *
 * Everything drawn here is derived from the normalized course geometry, so the
 * picture can never disagree with the numbers. It is a proportional strip map, not
 * a literal aerial view: the sequence, length and placement of every section are
 * exact, the real-world outline is not reproduced.
 */

export interface ActivationOverlay {
  skillName: string;
  /** Where the skill may fire. */
  windows: Section[];
  /** Sampled activation points, in metres. */
  samples: number[];
  /** Metre span the effect actually covered, per sample. */
  effective: Section[];
  /** Metre span the finish line cut off (drawn past the line). */
  wasted: Section[];
}

interface Band {
  key: string;
  label: string;
  start: number;
  end: number;
  row: number;
  fill: string;
  stroke?: string;
  description: string;
}

interface HoverInfo {
  key: string;
  description: string;
  start: number;
  end: number;
}

const PHASE_LABELS = ['Early', 'Mid', 'Late', 'Final spurt'];
const PHASE_FILLS = ['#2f4f6d', '#3a7188', '#3d9b8a', '#37d5c0'];

const ROW_Y = [10, 40, 66, 92, 118];
const ROW_H = [24, 22, 22, 22, 22];
const VIEW_W = 1000;
const VIEW_H = 176;

const hoverOf = (b: Band): HoverInfo => ({
  key: b.key,
  description: b.description,
  start: b.start,
  end: b.end,
});

function buildBands(course: Course): Band[] {
  const bands: Band[] = [];

  for (const p of course.phases) {
    bands.push({
      key: `phase-${p.phase}`,
      label: PHASE_LABELS[p.phase] ?? `Phase ${p.phase}`,
      start: p.start,
      end: p.end,
      row: 0,
      fill: PHASE_FILLS[p.phase] ?? PHASE_FILLS[0],
      description: `${PHASE_LABELS[p.phase] ?? `Phase ${p.phase}`} phase`,
    });
  }

  const finalCornerStart = course.finalCorner?.start ?? null;
  course.corners.forEach((c, i) => {
    const isFinal = finalCornerStart != null && c.start === finalCornerStart;
    bands.push({
      key: `corner-${i}`,
      label: isFinal ? `Final corner` : `Corner ${i + 1}`,
      start: c.start,
      end: c.end,
      row: 1,
      fill: isFinal ? '#d98a1f' : '#8a6a2f',
      stroke: isFinal ? '#f0b429' : undefined,
      description: isFinal ? 'Final corner' : `Corner ${i + 1}`,
    });
  });

  course.straights.forEach((s, i) => {
    const isFinal = s.start >= course.finalStraightStart;
    bands.push({
      key: `straight-${i}`,
      label: isFinal ? 'Final straight' : s.kind === 'home' ? 'Home straight' : 'Backstretch',
      start: s.start,
      end: s.end,
      row: 2,
      fill: isFinal ? '#4a6fa5' : '#33465e',
      stroke: isFinal ? '#6aa9ff' : undefined,
      description: isFinal
        ? 'Final straight'
        : s.kind === 'home'
          ? 'Home straight'
          : 'Backstretch straight',
    });
  });

  course.uphills.forEach((s, i) => {
    bands.push({
      key: `up-${i}`,
      label: `Uphill ${s.gradePercent}%`,
      start: s.start,
      end: s.end,
      row: 3,
      fill: '#a13b4c',
      description: `Uphill, ${s.gradePercent}% grade`,
    });
  });
  course.downhills.forEach((s, i) => {
    bands.push({
      key: `down-${i}`,
      label: `Downhill ${s.gradePercent}%`,
      start: s.start,
      end: s.end,
      row: 3,
      fill: '#2f6fa8',
      description: `Downhill, ${s.gradePercent}% grade`,
    });
  });

  return bands;
}

/** Text alternative read by screen readers and shown in the <details> fallback. */
export function describeCourse(course: Course): string {
  const seq: { at: number; text: string }[] = [];
  course.corners.forEach((c, i) =>
    seq.push({ at: c.start, text: `corner ${i + 1} from ${c.start} to ${c.end} m` }),
  );
  course.straights.forEach((s) =>
    seq.push({
      at: s.start,
      text: `${s.start >= course.finalStraightStart ? 'final straight' : s.kind === 'home' ? 'home straight' : 'backstretch'} from ${s.start} to ${s.end} m`,
    }),
  );
  course.uphills.forEach((s) =>
    seq.push({ at: s.start, text: `uphill of ${s.gradePercent}% from ${s.start} to ${s.end} m` }),
  );
  course.downhills.forEach((s) =>
    seq.push({ at: s.start, text: `downhill of ${s.gradePercent}% from ${s.start} to ${s.end} m` }),
  );
  seq.sort((a, b) => a.at - b.at);

  const phases = course.phases
    .map((p) => `${PHASE_LABELS[p.phase] ?? p.phase} ${p.start}-${p.end} m`)
    .join(', ');

  return (
    `${course.trackName}, ${course.surface}, ${course.distance} m, ` +
    `${DISTANCE_CATEGORY_LABELS[course.distanceCategory]} category, ${course.direction}-handed, ${course.layout} course. ` +
    `Start at 0 m, finish at ${course.distance} m. Phase boundaries: ${phases}. ` +
    `Section sequence: ${seq.map((s) => s.text).join('; ')}.`
  );
}

export function CourseDiagram({
  course,
  overlay,
  onSelectSection,
}: {
  course: Course;
  overlay?: ActivationOverlay | null;
  onSelectSection?: (band: { label: string; start: number; end: number }) => void;
}) {
  const descId = useId();
  const [active, setActive] = useState<HoverInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const bands = useMemo(() => buildBands(course), [course]);
  const x = (m: number) => (m / course.distance) * VIEW_W;
  const w = (s: Section) => Math.max(1.5, (sectionLength(s) / course.distance) * VIEW_W);

  // Metre ruler every 200 m, thinned out on long courses.
  const tickStep = course.distance > 2600 ? 500 : course.distance > 1600 ? 400 : 200;
  const ticks: number[] = [];
  for (let m = 0; m <= course.distance; m += tickStep) ticks.push(m);

  const showLabel = (b: Band) => w(b) > 52;

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={`${course.name} course map`}
          aria-describedby={descId}
          preserveAspectRatio="none"
          className="h-44 w-full min-w-[36rem] touch-pan-x select-none sm:h-52"
        >
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="var(--color-panel-2)" rx={8} />

          {/* section bands */}
          {bands.map((b) => {
            const isSelected = selected === b.key;
            const isActive = active?.key === b.key;
            return (
              <g key={b.key}>
                <rect
                  x={x(b.start)}
                  y={ROW_Y[b.row]}
                  width={w(b)}
                  height={ROW_H[b.row]}
                  rx={3}
                  fill={b.fill}
                  fillOpacity={isActive || isSelected ? 1 : 0.82}
                  stroke={isSelected ? 'var(--color-accent)' : (b.stroke ?? 'transparent')}
                  strokeWidth={isSelected ? 2.5 : 1}
                  tabIndex={0}
                  role="button"
                  aria-label={`${b.description}, ${Math.round(b.start)} to ${Math.round(b.end)} metres`}
                  className="cursor-pointer outline-none focus-visible:stroke-[var(--color-accent)] focus-visible:[stroke-width:2.5]"
                  onMouseEnter={() => setActive(hoverOf(b))}
                  onMouseLeave={() => setActive((p) => (p?.key === b.key ? null : p))}
                  onFocus={() => setActive(hoverOf(b))}
                  onBlur={() => setActive((p) => (p?.key === b.key ? null : p))}
                  onClick={() => {
                    setSelected(isSelected ? null : b.key);
                    onSelectSection?.({ label: b.description, start: b.start, end: b.end });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(isSelected ? null : b.key);
                      onSelectSection?.({ label: b.description, start: b.start, end: b.end });
                    }
                  }}
                />
                {showLabel(b) && (
                  <text
                    x={x(b.start) + w(b) / 2}
                    y={ROW_Y[b.row] + ROW_H[b.row] / 2 + 3.5}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#e6edf5"
                    pointerEvents="none"
                  >
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* skill activation overlay */}
          {overlay && (
            <g>
              {overlay.windows.map((win, i) => (
                <rect
                  key={`win-${i}`}
                  x={x(win.start)}
                  y={ROW_Y[4]}
                  width={w(win)}
                  height={ROW_H[4]}
                  rx={3}
                  fill="var(--color-accent)"
                  fillOpacity={0.18}
                  stroke="var(--color-accent)"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                />
              ))}
              {overlay.effective.map((eff, i) => (
                <rect
                  key={`eff-${i}`}
                  x={x(eff.start)}
                  y={ROW_Y[4] + 4}
                  width={w(eff)}
                  height={ROW_H[4] - 8}
                  rx={2}
                  fill="var(--color-accent)"
                  fillOpacity={0.55}
                  role="img"
                  aria-label={`Effective portion, ${Math.round(eff.start)} to ${Math.round(eff.end)} metres`}
                  onMouseEnter={() =>
                    setActive({
                      key: `eff-${i}`,
                      description: 'Effective portion of the skill',
                      start: eff.start,
                      end: eff.end,
                    })
                  }
                  onMouseLeave={() => setActive((p) => (p?.key === `eff-${i}` ? null : p))}
                />
              ))}
              {overlay.wasted.map((wst, i) => (
                <rect
                  key={`wst-${i}`}
                  x={x(Math.min(wst.start, course.distance))}
                  y={ROW_Y[4] + 4}
                  width={Math.max(2, ((wst.end - wst.start) / course.distance) * VIEW_W)}
                  height={ROW_H[4] - 8}
                  rx={2}
                  fill="var(--color-bad)"
                  fillOpacity={0.5}
                  role="img"
                  aria-label={`Wasted past the finish, ${Math.round(wst.end - wst.start)} metres`}
                  onMouseEnter={() =>
                    setActive({
                      key: `wst-${i}`,
                      description: 'Wasted past the finish line',
                      start: wst.start,
                      end: wst.end,
                    })
                  }
                  onMouseLeave={() => setActive((p) => (p?.key === `wst-${i}` ? null : p))}
                />
              ))}
              {overlay.samples.map((m, i) => (
                <g key={`s-${i}`}>
                  <line
                    x1={x(m)}
                    x2={x(m)}
                    y1={ROW_Y[4] - 3}
                    y2={ROW_Y[4] + ROW_H[4] + 3}
                    stroke="#ffffff"
                    strokeOpacity={0.75}
                    strokeWidth={1}
                  />
                  <circle
                    cx={x(m)}
                    cy={ROW_Y[4] - 5}
                    r={2.5}
                    fill="#ffffff"
                    role="img"
                    aria-label={`Sampled activation at ${Math.round(m)} metres`}
                    onMouseEnter={() =>
                      setActive({ key: `s-${i}`, description: 'Sampled activation point', start: m, end: m })
                    }
                    onMouseLeave={() => setActive((p) => (p?.key === `s-${i}` ? null : p))}
                  />
                </g>
              ))}
              {overlay.windows.length > 0 && (
                <text
                  x={x(overlay.windows[0].start) + 4}
                  y={ROW_Y[4] - 8}
                  fontSize={10}
                  fill="var(--color-accent)"
                >
                  {overlay.skillName}
                </text>
              )}
            </g>
          )}

          {/* start / finish */}
          <line x1={0.5} x2={0.5} y1={4} y2={VIEW_H - 26} stroke="#93a4b8" strokeWidth={2} />
          <text x={4} y={VIEW_H - 14} fontSize={11} fill="#93a4b8">
            Start 0 m
          </text>
          <line
            x1={VIEW_W - 0.5}
            x2={VIEW_W - 0.5}
            y1={4}
            y2={VIEW_H - 26}
            stroke="var(--color-accent)"
            strokeWidth={2.5}
          />
          <text x={VIEW_W - 4} y={VIEW_H - 14} fontSize={11} fill="var(--color-accent)" textAnchor="end">
            Finish {course.distance} m
          </text>

          {/* ruler */}
          {ticks.map((m) => (
            <g key={`t-${m}`}>
              <line
                x1={x(m)}
                x2={x(m)}
                y1={VIEW_H - 26}
                y2={VIEW_H - 21}
                stroke="#3d4d61"
                strokeWidth={1}
              />
              {m > 0 && m < course.distance && (
                <text x={x(m)} y={VIEW_H - 11} fontSize={9} fill="#6b7d93" textAnchor="middle">
                  {m}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <p id={descId} className="sr-only">
        {describeCourse(course)}
      </p>

      <figcaption
        className="mt-2 min-h-[1.5rem] text-xs text-[var(--color-ink-dim)]"
        aria-live="polite"
      >
        {active ? (
          <span>
            <strong className="text-[var(--color-ink)]">{active.description}</strong>{' '}
            {active.end > active.start
              ? `${Math.round(active.start)} - ${Math.round(active.end)} m (${Math.round(active.end - active.start)} m long)`
              : `${Math.round(active.start)} m`}
          </span>
        ) : (
          <span>
            Hover, tab to or click a section for its exact metre range. Proportional map: section
            order and length are exact, the shape is schematic.
          </span>
        )}
      </figcaption>

      {overlay && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--color-ink-dim)]">
          <span>
            <i className="mr-1 inline-block h-2 w-3 align-middle bg-[var(--color-accent)] opacity-30" />
            Valid activation region
          </span>
          <span>
            <i className="mr-1 inline-block h-2 w-3 align-middle bg-[var(--color-accent)] opacity-70" />
            Effective portion
          </span>
          <span>
            <i className="mr-1 inline-block h-2 w-3 align-middle bg-[var(--color-bad)] opacity-70" />
            Wasted past the finish
          </span>
          <span>
            <i className="mr-1 inline-block h-2 w-3 align-middle bg-white" />
            Sampled activation point
          </span>
        </div>
      )}
    </figure>
  );
}
