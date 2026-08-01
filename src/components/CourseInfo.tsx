'use client';

import { memo } from 'react';

import { DISTANCE_CATEGORY_LABELS } from '@/courses/distanceCategory';
import { summarizeCourse } from '@/courses/sections';
import type { Course, Skill } from '@/simulation/types';
import { CourseDiagram, describeCourse, type ActivationOverlay } from './CourseDiagram';
import { Badge, ExternalLink, Panel, Tooltip } from './ui';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const body = (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2">
      <div className="text-[10px] tracking-wide uppercase text-[var(--color-ink-dim)]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
  return hint ? <Tooltip label={hint}>{body}</Tooltip> : body;
}

function CourseInfoImpl({
  course,
  baselineFinishTime,
  greenSkills,
  overlay,
}: {
  course: Course;
  baselineFinishTime: number | null;
  greenSkills: Skill[];
  overlay?: ActivationOverlay | null;
}) {
  const s = summarizeCourse(course);

  return (
    <Panel
      title="Course information"
      subtitle={`${course.trackName} - ${course.surface === 'turf' ? 'Turf' : 'Dirt'} ${course.distance} m`}
      right={
        <div className="flex flex-wrap gap-1">
          <Badge tone="accent">{DISTANCE_CATEGORY_LABELS[course.distanceCategory]}</Badge>
          <Badge>{course.direction}</Badge>
          <Badge>{course.layout}</Badge>
          {course.statThresholds.map((t) => (
            <Badge key={t} tone="warn" title="Stat check the game highlights for this course">
              {t} check
            </Badge>
          ))}
        </div>
      }
    >
      <CourseDiagram course={course} overlay={overlay} />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total distance" value={`${s.distance} m`} />
        <Stat
          label="Category"
          value={DISTANCE_CATEGORY_LABELS[course.distanceCategory]}
          hint="Sprint 1000-1400 m, Mile 1500-1800 m, Medium 1900-2400 m, Long 2500 m and above."
        />
        <Stat label="Straights" value={`${s.straightCount} (${s.straightMeters} m)`} />
        <Stat label="Corners" value={`${s.cornerCount} (${s.cornerMeters} m)`} />
        <Stat label="Uphill" value={s.uphillCount ? `${s.uphillCount} (${s.uphillMeters} m)` : 'None'} />
        <Stat
          label="Downhill"
          value={s.downhillCount ? `${s.downhillCount} (${s.downhillMeters} m)` : 'None'}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {s.phaseBoundaries.map((p) => (
          <Stat key={p.phase} label={p.label} value={`${p.start} - ${p.end} m`} />
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs">
          <span className="text-[var(--color-ink-dim)]">Final straight </span>
          <span className="font-semibold">
            {course.finalStraightStart} m to finish ({s.finalStraightMeters} m)
          </span>
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs">
          <span className="text-[var(--color-ink-dim)]">Last spurt can start at </span>
          <span className="font-semibold">{course.spurtStart ? `${course.spurtStart.meters} m` : '-'}</span>
          {course.spurtStart?.location.length ? (
            <span className="text-[var(--color-ink-dim)]"> ({course.spurtStart.location.join(', ')})</span>
          ) : null}
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs">
          <span className="text-[var(--color-ink-dim)]">Baseline finish time (no skills) </span>
          <span className="font-semibold">
            {baselineFinishTime != null ? `${baselineFinishTime.toFixed(2)} s` : '-'}
          </span>
        </div>
      </div>

      <details className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs">
        <summary className="cursor-pointer text-[var(--color-ink-dim)]">
          Text description of the course layout
        </summary>
        <p className="mt-2 leading-relaxed text-[var(--color-ink-dim)]">{describeCourse(course)}</p>
      </details>

      <div className="mt-4">
        <h3 className="text-xs font-semibold tracking-wide uppercase text-[var(--color-ink-dim)]">
          Course-related green skills that apply here
        </h3>
        {greenSkills.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--color-ink-dim)]">
            No passive course skill matches this racecourse.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {greenSkills.map((g) => (
              <Tooltip key={g.id} label={g.description}>
                <span className="inline-flex items-center gap-1 rounded border border-emerald-400/50 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">
                  <ExternalLink href={g.gameToraUrl}>{g.name}</ExternalLink>
                  {g.baseCost != null && <span className="opacity-60">{g.baseCost} SP</span>}
                </span>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * Memoized: the page re-renders on every ranking progress tick and on every skill
 * row expansion, and none of that changes this panel's props.
 */
export const CourseInfo = memo(CourseInfoImpl);
