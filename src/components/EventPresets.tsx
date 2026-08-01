'use client';

import { useMemo, useState } from 'react';

import { eventPresets, type ChampionsMeetingPreset } from '@/data';
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
export function EventPresets({
  selection,
  onApply,
}: {
  selection: Selection;
  onApply: (s: Selection) => void;
}) {
  const [showReleased, setShowReleased] = useState(false);

  const cm = eventPresets.championsMeeting;
  const loh = eventPresets.leagueOfHeroes;

  const entries = useMemo(() => {
    const list = showReleased
      ? cm.entries
      : cm.entries.filter((e) => e.status === 'upcoming-on-global');
    return list.slice().sort((a, b) => a.id - b.id);
  }, [cm.entries, showReleased]);

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
          label={showReleased ? 'Showing all cups' : 'Upcoming on Global only'}
          checked={!showReleased}
          onChange={() => setShowReleased(!showReleased)}
        />
      }
    >
      <p className="mb-3 text-xs text-[var(--color-ink-dim)]">
        Global runs the Champions Meeting cups in the same order as the Japanese server, so a cup Japan
        has already held is a preview of an upcoming Global one. Global has run up to{' '}
        <strong className="text-[var(--color-ink)]">cup {cm.highestGlobalId}</strong>; the next is{' '}
        <strong className="text-[var(--color-ink)]">cup {cm.firstUpcomingId ?? '-'}</strong>.
      </p>

      {entries.length === 0 ? (
        <EmptyState title="No cups to show" hint="Turn off the upcoming-only filter." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => {
            const active = selection.courseId === e.courseId;
            const band = getDistanceCategory(e.distance);
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
                  {e.status === 'released-on-global' ? (
                    <Badge tone="neutral">already run</Badge>
                  ) : (
                    <Badge tone="unique">upcoming</Badge>
                  )}
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
          <Tooltip label="If GameTora starts publishing a League of Heroes schedule, `npm run data:refresh` will pick it up and presets will appear here automatically.">
            <span className="cursor-help underline decoration-dotted">What would change this?</span>
          </Tooltip>
        </p>
      </div>
    </Panel>
  );
}
