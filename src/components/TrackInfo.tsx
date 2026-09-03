'use client';

import { memo, useMemo } from 'react';

import { DISTANCE_CATEGORY_LABELS } from '@/courses/distanceCategory';
import {
  computeTrackInfo,
  describeSpurtGeometry,
  downhillModeChancePerSecond,
  downhillSpeedBonus,
  statThresholdMultiplier,
  uphillSpeedPenalty,
} from '@/courses/trackInfo';
import type { RunnerConfig } from '@/simulation/config';
import type { Course, Skill } from '@/simulation/types';
import { CourseDiagram, describeCourse, type ActivationOverlay } from './CourseDiagram';
import { Badge, ExternalLink, Panel, Tooltip } from './ui';

const LAYOUT_LABELS: Record<string, string> = {
  standard: 'single layout',
  inner: 'inner track',
  outer: 'outer track',
  'outer-inner': 'outer then inner track',
};

const m = (v: number) => `${Math.round(v)} m`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const body = (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2">
      <div className="text-[10px] tracking-wide uppercase text-[var(--color-ink-dim)]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
  return hint ? <Tooltip label={hint}>{body}</Tooltip> : body;
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)]/60 p-3">
      <h3 className="text-xs font-semibold tracking-wide uppercase text-[var(--color-ink-dim)]">{title}</h3>
      <p className="mt-1 text-xs text-[var(--color-ink-dim)]">{hint}</p>
      <div className="mt-2 text-xs">{children}</div>
    </div>
  );
}

function TrackInfoImpl({
  course,
  runner,
  greenSkills,
  overlay,
}: {
  course: Course;
  runner: RunnerConfig;
  greenSkills: Skill[];
  overlay?: ActivationOverlay | null;
}) {
  const info = useMemo(() => computeTrackInfo(course), [course]);
  const stats = { speed: runner.speed, stamina: runner.stamina, power: runner.power, guts: runner.guts, wit: runner.wit };
  const thresholdMultiplier = statThresholdMultiplier(course.statThresholds, stats);
  const geometryTone = info.spurt.geometry === 'final-corner-contains-spurt' ? 'accent' : info.spurt.geometry === 'final-corner-before-spurt' ? 'bad' : 'warn';

  return (
    <Panel
      title="Track information"
      subtitle={`${course.name} - ${LAYOUT_LABELS[course.layout] ?? course.layout}, ${course.direction === 'straight' ? 'straight course' : `${course.direction}-handed`}, ${info.laps > 1 ? `${info.laps} laps` : '1 lap'}`}
      right={
        <div className="flex flex-wrap gap-1">
          <Badge tone="accent">{DISTANCE_CATEGORY_LABELS[course.distanceCategory]}</Badge>
          <Badge>{course.surface === 'turf' ? 'Turf' : 'Dirt'}</Badge>
          {info.isBasisDistance && <Badge title="Distance divisible by 400 m; a few skills check this">Basis distance</Badge>}
          {course.statThresholds.map((t) => (
            <Badge key={t} tone="warn" title="Stat the course rewards with a Speed bonus (see stat thresholds)">
              {t} check
            </Badge>
          ))}
        </div>
      }
    >
      <CourseDiagram course={course} overlay={overlay} />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Distance" value={m(info.distance)} />
        <Stat label="Base speed" value={`${info.baseSpeed.toFixed(2)} m/s`} hint="20 - (distance - 2000) / 1000. Target speeds, the start dash and the minimum speed all scale from this." />
        <Stat label="Final leg begins" value={m(info.spurt.earliestSpurt)} hint="2/3 of the distance: target speed jumps, and the last spurt can begin here if stamina allows." />
        <Stat label="Final corner" value={info.finalCorner ? `${m(info.finalCorner.start)} - ${m(info.finalCorner.end)}` : 'none'} hint="'Final corner' skill conditions stay true from here to the finish line." />
        <Stat label="Final straight" value={info.finalStraight ? `${m(info.finalStraight.start)} - finish` : m(course.finalStraightStart)} />
        <Stat label="Spurt plan tail" value={m(info.spurt.planTail)} hint="The spurt planner assumes the spurt must last until 60 m before the line." />
      </div>

      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${geometryTone === 'accent' ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10' : geometryTone === 'bad' ? 'border-[var(--color-bad)]/50 bg-[var(--color-bad)]/10' : 'border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10'}`}>
        <span className="font-semibold">Acceleration timing. </span>
        {describeSpurtGeometry(info)}
        {info.spurt.slopeAtSpurt && (
          <span>
            {' '}
            The 2/3 mark is on a {info.spurt.slopeAtSpurt.kind === 'up' ? 'climb' : 'descent'} of {info.spurt.slopeAtSpurt.gradePercent}%.
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="Race phases" hint="The race is cut at 1/6, 2/3 and 5/6 of the distance. Strategy speed and acceleration multipliers change at the 1/6 and 2/3 marks, and most skills only fire inside one phase.">
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {info.phases.map((p) => (
              <li key={p.phase} className="rounded border border-[var(--color-line)] px-2 py-1">
                <div className="font-semibold">{p.label}</div>
                <div className="text-[var(--color-ink-dim)]">
                  {m(p.start)} - {m(p.end)}
                </div>
                <div className="text-[var(--color-ink-dim)]">
                  sections {p.sections[0]}-{p.sections[1]}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="24 sections" hint="Each section re-rolls a small Wit-based speed wobble. Rushing can only begin in sections 3-9, and position keep (pacing behind the leader) lasts through section 10.">
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            <li>
              Section length <span className="font-semibold">{info.sectionLength.toFixed(1)} m</span>
            </li>
            <li>
              Position keep <span className="font-semibold">0 - {m(info.positionKeepEnd)}</span>
            </li>
            <li>
              Rush window <span className="font-semibold">{m(info.rushWindow.start)} - {m(info.rushWindow.end)}</span>
            </li>
            <li>
              Spot struggle <span className="font-semibold">150 - {m(info.distance / 4)}</span>
            </li>
            <li>
              Rush chance <span className="font-semibold">{Math.round(Math.pow(0.65 / Math.log10(0.1 * runner.wit + 1), 2) * 100)}%</span>
            </li>
            <li>
              Downhill mode <span className="font-semibold">{Math.round(downhillModeChancePerSecond(runner.wit) * 100)}% / s</span>
            </li>
          </ul>
        </Section>

        <Section title="Corners" hint="Numbered like a real oval: 1 to 4, with the 4th corner leading into the home straight. On two-lap courses the early corners repeat, so a 'corner 4' skill may fire on the first lap.">
          {info.corners.length === 0 ? (
            <p>No corners: every corner skill is dead here.</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {info.corners.map((c) => (
                <li key={c.order} className={`rounded border px-2 py-1 ${c.isFinal ? 'border-[var(--color-accent)]/60' : 'border-[var(--color-line)]'}`}>
                  <span className="font-semibold">Corner {c.number}</span>
                  {c.repeated && <span className="text-[var(--color-ink-dim)]"> (lap {c.order <= info.corners.length - 4 ? 1 : 2})</span>}
                  <div className="text-[var(--color-ink-dim)]">
                    {m(c.start)} - {m(c.end)}
                    {c.isFinal ? ' - final, second half from ' + m(c.mid) : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Straights and slopes" hint="Only the stand-side (home) and back straights count as straights; the stretches between are neither straight nor corner. Uphill drains speed by grade x 200 / Power; downhill gives a Wit-based chance of +0.3 m/s plus grade / 10 with 60% less stamina drain.">
          <ul className="flex flex-wrap gap-1">
            {info.straights.map((s, i) => (
              <li key={i} className={`rounded border px-2 py-1 ${s.isFinal ? 'border-[var(--color-accent)]/60' : 'border-[var(--color-line)]'}`}>
                <span className="font-semibold">{s.kind === 'home' ? 'Home' : s.kind === 'back' ? 'Back' : 'Other'} straight</span>
                <div className="text-[var(--color-ink-dim)]">
                  {m(s.start)} - {m(s.end)}
                  {s.isFinal ? ' - final' : ''}
                </div>
              </li>
            ))}
            {info.slopes.map((s, i) => (
              <li key={`s${i}`} className="rounded border border-[var(--color-line)] px-2 py-1">
                <span className="font-semibold">{s.kind === 'up' ? 'Uphill' : 'Downhill'} {s.gradePercent}%</span>
                <div className="text-[var(--color-ink-dim)]">
                  {m(s.start)} - {m(s.end)}
                  {s.kind === 'up' ? ` - about -${uphillSpeedPenalty(s.gradePercent, runner.power).toFixed(2)} m/s` : ` - up to +${downhillSpeedBonus(s.gradePercent).toFixed(2)} m/s`}
                </div>
              </li>
            ))}
            {info.noMansLand.map((g, i) => (
              <li key={`n${i}`} className="rounded border border-dashed border-[var(--color-line)] px-2 py-1 text-[var(--color-ink-dim)]">
                Neither straight nor corner: {m(g.start)} - {m(g.end)}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Stat thresholds" hint="The course rewards its listed stats with a Speed multiplier: +5% up to 300, +10% to 600, +15% to 900, +20% from 901 (averaged over the listed stats).">
          {course.statThresholds.length === 0 ? (
            <p>No stat threshold on this course.</p>
          ) : (
            <p>
              {course.statThresholds.join(' and ')} - your build gets <span className="font-semibold">x{thresholdMultiplier.toFixed(3)}</span> Speed.
            </p>
          )}
        </Section>

        <Section title="Course-related passives that apply here" hint="Green skills whose track, surface, direction, distance, season, weather or ground condition matches this race.">
          {greenSkills.length === 0 ? (
            <p>No passive course skill matches this racecourse.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
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
        </Section>
      </div>

      <details className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs">
        <summary className="cursor-pointer text-[var(--color-ink-dim)]">Text description of the course layout</summary>
        <p className="mt-2 leading-relaxed text-[var(--color-ink-dim)]">{describeCourse(course)}</p>
      </details>
    </Panel>
  );
}

export const TrackInfo = memo(TrackInfoImpl);
