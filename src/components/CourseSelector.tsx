'use client';

import { useMemo } from 'react';

import { courses, trackNames } from '@/data';
import {
  RUNNING_STYLES,
  RUNNING_STYLE_LABELS,
  type RunningStyle,
  type Season,
  type Surface,
  type TrackCondition,
  type Weather,
} from '@/simulation/config';
import type { Course } from '@/simulation/types';
import { Panel, Select, Tooltip } from './ui';

export interface Selection {
  trackName: string;
  surface: Surface;
  distance: number;
  courseId: number;
  runningStyle: RunningStyle;
  trackCondition: TrackCondition;
  weather: Weather;
  season: Season;
}

const CONDITION_LABELS: Record<TrackCondition, string> = {
  firm: 'Firm',
  good: 'Good',
  soft: 'Soft',
  heavy: 'Heavy',
};

const WEATHER_LABELS: Record<Weather, string> = {
  sunny: 'Sunny',
  cloudy: 'Cloudy',
  rainy: 'Rainy',
  snowy: 'Snowy',
};

const SEASON_LABELS: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
  sakura: 'Cherry blossom',
};

const DIRECTION_LABELS: Record<string, string> = {
  right: 'Right (clockwise)',
  left: 'Left (counter-clockwise)',
  straight: 'Straight',
};

const LAYOUT_LABELS: Record<string, string> = {
  inner: 'Inner',
  outer: 'Outer',
  'inner-outer': 'Inner to outer',
  'outer-inner': 'Outer to inner',
  standard: 'Standard',
};

export function resolveSelection(sel: Selection): Course | null {
  return courses.find((c) => c.id === sel.courseId) ?? null;
}

export function defaultSelection(): Selection {
  const preferred =
    courses.find((c) => c.trackName === 'Tokyo' && c.surface === 'turf' && c.distance === 2400) ?? courses[0];
  return {
    trackName: preferred.trackName,
    surface: preferred.surface,
    distance: preferred.distance,
    courseId: preferred.id,
    runningStyle: 'pace_chaser',
    trackCondition: 'firm',
    weather: 'sunny',
    season: 'spring',
  };
}

export function CourseSelector({
  selection,
  onChange,
}: {
  selection: Selection;
  onChange: (s: Selection) => void;
}) {
  const trackCourses = useMemo(
    () => courses.filter((c) => c.trackName === selection.trackName),
    [selection.trackName],
  );
  const surfaces = useMemo(
    () => [...new Set(trackCourses.map((c) => c.surface))] as Surface[],
    [trackCourses],
  );
  const surfaceCourses = useMemo(
    () => trackCourses.filter((c) => c.surface === selection.surface),
    [trackCourses, selection.surface],
  );
  const distances = useMemo(
    () => [...new Set(surfaceCourses.map((c) => c.distance))].sort((a, b) => a - b),
    [surfaceCourses],
  );
  const layouts = useMemo(
    () => surfaceCourses.filter((c) => c.distance === selection.distance),
    [surfaceCourses, selection.distance],
  );

  const current = courses.find((c) => c.id === selection.courseId) ?? null;

  const pickTrack = (trackName: string) => {
    const first = courses.find((c) => c.trackName === trackName)!;
    onChange({
      ...selection,
      trackName,
      surface: first.surface,
      distance: first.distance,
      courseId: first.id,
    });
  };

  const pickSurface = (surface: string) => {
    const first = trackCourses.find((c) => c.surface === surface)!;
    onChange({ ...selection, surface: surface as Surface, distance: first.distance, courseId: first.id });
  };

  const pickDistance = (distance: number) => {
    const first = surfaceCourses.find((c) => c.distance === distance)!;
    onChange({ ...selection, distance, courseId: first.id });
  };

  return (
    <Panel title="Race setup" subtitle="Global (EN) racecourses only">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Select
          label="Racecourse"
          value={selection.trackName}
          onChange={pickTrack}
          options={trackNames.map((t) => ({ value: t, label: t }))}
        />
        <Select
          label="Surface"
          value={selection.surface}
          onChange={pickSurface}
          options={surfaces.map((s) => ({ value: s, label: s === 'turf' ? 'Turf' : 'Dirt' }))}
        />
        <Select
          label="Distance"
          value={selection.distance}
          onChange={(v) => pickDistance(Number(v))}
          options={distances.map((d) => ({ value: d, label: `${d} m` }))}
        />
        <Select
          label="Course layout"
          value={selection.courseId}
          onChange={(v) => onChange({ ...selection, courseId: Number(v) })}
          options={layouts.map((c) => ({
            value: c.id,
            label: `${LAYOUT_LABELS[c.layout] ?? c.layout} - ${c.corners.length} corners`,
          }))}
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-ink-dim)]">Track direction</span>
          <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)]/50 px-2 py-1.5 text-sm text-[var(--color-ink-dim)]">
            {current ? (DIRECTION_LABELS[current.direction] ?? current.direction) : '-'}
          </div>
        </div>
        <Select
          label="Running style"
          value={selection.runningStyle}
          onChange={(v) => onChange({ ...selection, runningStyle: v as RunningStyle })}
          options={RUNNING_STYLES.map((s) => ({ value: s, label: RUNNING_STYLE_LABELS[s] }))}
        />
        <Select
          label="Track condition"
          value={selection.trackCondition}
          onChange={(v) => onChange({ ...selection, trackCondition: v as TrackCondition })}
          options={(Object.keys(CONDITION_LABELS) as TrackCondition[]).map((c) => ({
            value: c,
            label: CONDITION_LABELS[c],
          }))}
        />
        <Select
          label="Season"
          value={selection.season}
          onChange={(v) => onChange({ ...selection, season: v as Season })}
          options={(Object.keys(SEASON_LABELS) as Season[]).map((s) => ({ value: s, label: SEASON_LABELS[s] }))}
        />
        <Select
          label="Weather"
          value={selection.weather}
          onChange={(v) => onChange({ ...selection, weather: v as Weather })}
          options={(Object.keys(WEATHER_LABELS) as Weather[]).map((w) => ({
            value: w,
            label: WEATHER_LABELS[w],
          }))}
        />
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-dim)]">
        <Tooltip label="Season and weather only change which skills are allowed to activate. Track condition additionally changes the Speed / Power modifiers and stamina drain.">
          <span className="cursor-help underline decoration-dotted">
            How do season, weather and track condition affect the numbers?
          </span>
        </Tooltip>
      </p>
    </Panel>
  );
}
