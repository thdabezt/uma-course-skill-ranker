'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  cupState,
  dataAgeDays,
  dataMeta,
  eventPresets,
  nextCup,
  type ChampionsMeetingPreset,
  type CupState,
} from '@/data';
import { DISTANCE_CATEGORY_LABELS, getDistanceCategory } from '@/courses/distanceCategory';
import type { Selection } from './CourseSelector';
import { Badge, EmptyState, Panel, Toggle, Tooltip } from './ui';

/**
 * Champions Meeting / League of Heroes presets.
 *
 * A cup preset carries the full race definition the event runs under - racecourse,
 * distance, surface, direction, ground condition, season and weather - so clicking
 * one configures the whole analysis for that cup in a single step.
 */
const STATE_LABEL: Record<CupState, string> = {
  completed: 'already run',
  'running-now': 'running now',
  announced: 'announced',
  upcoming: 'upcoming',
};

const STATE_TONE: Record<CupState, 'neutral' | 'accent' | 'warn' | 'unique'> = {
  completed: 'neutral',
  'running-now': 'accent',
  announced: 'warn',
  upcoming: 'unique',
};

export function EventPresets({
  selection,
  onApply,
}: {
  selection: Selection;
  onApply: (s: Selection) => void;
}) {
  const [showReleased, setShowReleased] = useState(false);
  // Read the clock only after mount: a static export is prerendered at build time,
  // so using Date.now() during render would produce a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Math.floor(Date.now() / 1000)), []);

  const cm = eventPresets.championsMeeting;
  const loh = eventPresets.leagueOfHeroes;

  const entries = useMemo(() => {
    const list = showReleased
      ? cm.entries
      : cm.entries.filter((e) => cupState(e, now) !== 'completed');
    return list.slice().sort((a, b) => a.id - b.id);
  }, [cm.entries, showReleased, now]);

  const next = useMemo(() => nextCup(now), [now]);
  const ageDays = dataAgeDays(now);
  const stale = ageDays != null && ageDays > 30;

  const apply = (preset: ChampionsMeetingPreset) => {
    if (preset.courseId == null || preset.surface == null) return;
    onApply({
      ...selection,
      trackName: preset.courseName?.split(' ')[0] ?? selection.trackName,
      surface: preset.surface,
      distance: preset.distance,
      courseId: preset.courseId,
      trackCondition: preset.trackCondition,
      weather: preset.weather,
      season: preset.season,
    });
  };

  return (
    <Panel
      title="Event presets"
      subtitle="Load the exact race setup a Champions Meeting runs under"
      right={
        <Toggle
          label={showReleased ? 'Showing all cups' : 'Hiding finished cups'}
          checked={!showReleased}
          onChange={() => setShowReleased(!showReleased)}
        />
      }
    >
      <p className="mb-2 text-xs text-[var(--color-ink-dim)]">
        Global runs the Champions Meeting cups in the same order as the Japanese server, so a cup Japan
        has already held is a preview of an upcoming Global one. Next up:{' '}
        <strong className="text-[var(--color-ink)]">
          {next ? `cup ${next.id} - ${next.name}` : 'no cup scheduled'}
        </strong>
        .
      </p>
      <p className="mb-3 text-[11px] text-[var(--color-ink-dim)]">
        Cup status is worked out from each cup&apos;s own start and end dates, so a finished cup drops
        off this list on its own. New cups arrive with the daily data refresh - last fetched{' '}
        {new Date(dataMeta.dataFetchedAt).toISOString().slice(0, 10)}
        {ageDays != null && ` (${ageDays} day${ageDays === 1 ? '' : 's'} ago)`}.{' '}
        {stale && (
          <span className="text-[var(--color-warn)]">
            That snapshot is older than the refresh schedule should allow, so the scheduled job has
            probably stopped running - newly announced cups may be missing.
          </span>
        )}
      </p>

      {entries.length === 0 ? (
        <EmptyState title="No cups to show" hint="Turn off the upcoming-only filter." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => {
            const active = selection.courseId === e.courseId;
            const band = getDistanceCategory(e.distance);
            const state = cupState(e, now);
            return (
              <button
                key={`${e.kind}-${e.id}`}
                type="button"
                onClick={() => apply(e)}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-line)] bg-[var(--color-panel-2)] hover:border-[var(--color-accent)]/60'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{e.name}</span>
                  <span className="text-[10px] text-[var(--color-ink-dim)]">#{e.id}</span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-ink-dim)]">{e.courseName}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Badge tone="accent">{DISTANCE_CATEGORY_LABELS[band]}</Badge>
                  <Badge>{e.surface === 'turf' ? 'Turf' : 'Dirt'}</Badge>
                  <Badge>{e.trackCondition}</Badge>
                  <Badge>{e.season}</Badge>
                  {e.weather !== 'sunny' && <Badge tone="warn">{e.weather}</Badge>}
                  <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">League of Heroes</span>
          <Badge tone="warn">No presets available</Badge>
        </div>
        <p className="mt-1 text-[var(--color-ink-dim)]">
          {loh.reason}{' '}
          <Tooltip label="If GameTora starts publishing a League of Heroes schedule, the daily data refresh will pick it up and presets will appear here on their own.">
            <span className="cursor-help underline decoration-dotted">What would change this?</span>
          </Tooltip>
        </p>
      </div>
    </Panel>
  );
}
