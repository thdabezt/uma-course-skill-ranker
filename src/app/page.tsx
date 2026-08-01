'use client';

import { useEffect, useMemo, useState } from 'react';

import { CharacterRanking } from '@/components/CharacterRanking';
import { CourseInfo } from '@/components/CourseInfo';
import { CourseSelector, defaultSelection, resolveSelection, type Selection } from '@/components/CourseSelector';
import { DevExcluded } from '@/components/DevExcluded';
import { EventPresets } from '@/components/EventPresets';
import { RunnerPanel } from '@/components/RunnerPanel';
import { SkillRanking } from '@/components/SkillRanking';
import type { ActivationOverlay } from '@/components/CourseDiagram';
import { ErrorState, Spinner, Toggle } from '@/components/ui';
import { characters, dataMeta, skills, skillsById } from '@/data';
import { rankCharacters, type RankedCharacter } from '@/ranking/characterRanking';
import { rankSkills, type RankedSkill } from '@/ranking/rankSkills';
import type { SkillEvaluation } from '@/ranking/skillEvaluation';
import { DEFAULT_RUNNER, SIMULATION, type RunnerConfig } from '@/simulation/config';
import { conditionNames } from '@/skills/conditionParser';
import type { RaceSetup, RunnerStats } from '@/simulation/types';

/** Conditions that make a passive skill "course related" for the course panel. */
const COURSE_CONDITIONS = new Set([
  'rotation',
  'ground_type',
  'distance_type',
  'track_id',
  'is_basis_distance',
  'is_dirtgrade',
  'is_tight_track',
  'season',
  'weather',
  'ground_condition',
  'course_distance',
]);

interface Computed {
  rankedSkills: RankedSkill[];
  rankedCharacters: RankedCharacter[];
  baselineFinishTime: number;
}

export default function Page() {
  const [selection, setSelection] = useState<Selection>(() => defaultSelection());
  const [runner, setRunner] = useState<RunnerConfig>(DEFAULT_RUNNER);
  const [tab, setTab] = useState<'skills' | 'characters'>('skills');
  const [showDev, setShowDev] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);

  const [computing, setComputing] = useState(true);
  const [result, setResult] = useState<Computed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const course = resolveSelection(selection);

  const setup: RaceSetup | null = useMemo(
    () =>
      course
        ? {
            course,
            runningStyle: selection.runningStyle,
            trackCondition: selection.trackCondition,
            weather: selection.weather,
            season: selection.season,
          }
        : null,
    [course, selection.runningStyle, selection.trackCondition, selection.weather, selection.season],
  );

  const runnerStats: RunnerStats = useMemo(
    () => ({ ...runner, runningStyle: selection.runningStyle }),
    [runner, selection.runningStyle],
  );

  useEffect(() => {
    if (!setup) {
      setError('The selected racecourse could not be found in the Global data set.');
      setComputing(false);
      return;
    }
    let cancelled = false;
    setComputing(true);
    setError(null);

    // Yield a frame so the loading state paints before the (synchronous) simulation runs.
    const handle = setTimeout(() => {
      try {
        const { ranked, baseline } = rankSkills(skills, setup, runnerStats);
        const cache = new Map<number, SkillEvaluation>();
        for (const r of ranked) cache.set(r.skill.id, r.evaluation);
        const rankedCharacters = rankCharacters(characters, skillsById, baseline, cache);
        if (cancelled) return;
        setResult({
          rankedSkills: ranked,
          rankedCharacters,
          baselineFinishTime: baseline.baseline.finishTimeSeconds,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setComputing(false);
      }
    }, 16);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [setup, runnerStats, attempt]);

  const greenSkills = useMemo(() => {
    if (!result) return [];
    return result.rankedSkills
      .filter(
        (r) =>
          r.skill.isPassive &&
          r.evaluation.canActivate &&
          r.skill.conditionGroups.some((g) =>
            conditionNames(g.condition).some((n) => COURSE_CONDITIONS.has(n)),
          ),
      )
      .map((r) => r.skill)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [result]);

  /**
   * Activation regions of the expanded skill, projected onto the course diagram:
   * where it may fire, the sampled points, the metres its effect actually covered
   * and the metres the finish line cut off.
   */
  const overlay: ActivationOverlay | null = useMemo(() => {
    if (!result || selectedSkillId == null || !course) return null;
    const row = result.rankedSkills.find((r) => r.skill.id === selectedSkillId);
    if (!row || !row.evaluation.canActivate) return null;
    const group = row.evaluation.groups.find((g) => g.samples.length > 0);
    if (!group) return null;

    const effective: { start: number; end: number }[] = [];
    const wasted: { start: number; end: number }[] = [];
    for (const s of group.samples) {
      // Approximate the covered distance from the runner's finishing pace.
      const pace = course.distance / result.baselineFinishTime;
      const covered = s.effectiveDurationSeconds * pace;
      const lost = s.wastedDurationSeconds * pace;
      const end = Math.min(course.distance, s.activationMeters + covered);
      if (end > s.activationMeters) effective.push({ start: s.activationMeters, end });
      if (lost > 0) wasted.push({ start: end, end: end + lost });
    }

    return {
      skillName: row.skill.name,
      windows: group.activation.windows,
      samples: group.samples.map((s) => s.activationMeters),
      effective,
      wasted,
    };
  }, [result, selectedSkillId, course]);

  return (
    <main className="mx-auto w-full max-w-[110rem] space-y-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Uma Musume Course Skill Ranker</h1>
          <p className="mt-1 text-xs text-[var(--color-ink-dim)]">
            Global (EN) data only. Skills and characters are ranked by a deterministic race simulation at{' '}
            {(1 / SIMULATION.frameSeconds).toFixed(0)} frames per second.
          </p>
        </div>
        <Toggle label="Developer view" checked={showDev} onChange={setShowDev} />
      </header>

      <CourseSelector selection={selection} onChange={setSelection} />
      <EventPresets selection={selection} onApply={setSelection} />
      <RunnerPanel runner={runner} onChange={setRunner} />

      {error && (
        <ErrorState
          title="The ranking could not be computed"
          detail={error}
          onRetry={() => setAttempt((a) => a + 1)}
        />
      )}

      {course && (
        <CourseInfo
          course={course}
          baselineFinishTime={result?.baselineFinishTime ?? null}
          greenSkills={greenSkills}
          overlay={overlay}
        />
      )}

      <div className="flex gap-1.5">
        <Toggle label="Skill ranking" checked={tab === 'skills'} onChange={() => setTab('skills')} />
        <Toggle label="Character ranking" checked={tab === 'characters'} onChange={() => setTab('characters')} />
      </div>

      {computing && <Spinner label="Running the race simulation for every Global skill..." />}

      {!computing && result && tab === 'skills' && (
        <SkillRanking
          ranked={result.rankedSkills}
          selectedSkillId={selectedSkillId}
          onSelectSkill={setSelectedSkillId}
        />
      )}
      {!computing && result && tab === 'characters' && (
        <CharacterRanking
          ranked={result.rankedCharacters}
          runningStyle={selection.runningStyle}
          evolutionAvailable={dataMeta.evolutionSkillsAvailableOnGlobal}
        />
      )}

      {showDev && <DevExcluded />}

      <footer className="space-y-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-xs text-[var(--color-ink-dim)]">
        <p>
          <strong className="text-[var(--color-ink)]">Data source:</strong> skill, character and racecourse data
          is derived from the public static JSON that{' '}
          <a
            href={dataMeta.source.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-accent)] underline"
          >
            {dataMeta.source.name}
          </a>{' '}
          publishes for its own site. Fetched {new Date(dataMeta.dataFetchedAt).toUTCString()}; normalized{' '}
          {new Date(dataMeta.generatedAt).toUTCString()}. A scheduled job re-checks the upstream data daily
          and redeploys this site whenever it changes.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Scope:</strong> {dataMeta.counts.courses} racecourses,{' '}
          {dataMeta.counts.skills} skills and {dataMeta.counts.characters} characters released on the Global
          server. {dataMeta.counts.excludedSkills} skills, {dataMeta.counts.excludedCharacters} characters and{' '}
          {dataMeta.counts.excludedCourses} racecourses that are Japan-only are excluded.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Disclaimer:</strong> all numbers come from an independent
          simulation of publicly documented mechanics, run against a single reference runner with no opponents.
          They are a modelling aid, not official values. Uma Musume: Pretty Derby is the property of Cygames;
          this project is unaffiliated with Cygames and with GameTora.
        </p>
      </footer>
    </main>
  );
}
