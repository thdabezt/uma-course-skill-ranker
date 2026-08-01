'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { rankCharactersFrom, type RankedCharacter } from '@/ranking/characterRanking';
import { rankSkills } from '@/ranking/rankSkills';
import type { TransportSkillEvaluation } from '@/ranking/transport';
import type { RankedSkillView } from '@/worker/rankingProtocol';
import { RankingPool, workersSupported } from '@/worker/rankingPool';
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
  rankedSkills: RankedSkillView[];
  rankedCharacters: RankedCharacter[];
  baselineFinishTime: number;
}

/**
 * Trailing debounce before a ranking starts.
 *
 * Long enough to swallow a stepper drag or a retyped stat, short enough that a
 * deliberate click on a racecourse still feels immediate.
 */
const COMPUTE_DEBOUNCE_MS = 250;

/**
 * A ranking is a pure function of (race setup, runner), so switching back to a
 * previous setup can be free. Kept small: each entry holds all 653 evaluations with
 * their full per-sample debug payload, which is what the details panel renders.
 */
const RESULT_CACHE_LIMIT = 6;

function computeKey(setup: RaceSetup, runner: RunnerStats): string {
  return [
    setup.course.id,
    setup.runningStyle,
    setup.trackCondition,
    setup.weather,
    setup.season,
    runner.speed,
    runner.stamina,
    runner.power,
    runner.guts,
    runner.wit,
    runner.mood,
    runner.distanceAptitude,
    runner.surfaceAptitude,
    runner.styleAptitude,
    runner.skillActivationRate,
    runner.startDelaySeconds,
    runner.postNumber,
    runner.popularity,
  ].join('|');
}

export default function Page() {
  const [selection, setSelection] = useState<Selection>(() => defaultSelection());
  /**
   * Which event preset produced the current setup, if any.
   *
   * Stored rather than derived: the cup schedule reuses racecourses, and cups 31 and
   * 46 are identical in every race field, so no comparison against `selection` can
   * distinguish them. The stored setup is kept alongside the key so the highlight
   * heals itself - any hand edit in the course selector stops matching and the badge
   * clears without needing an explicit reset on every code path that edits the setup.
   */
  const [appliedPreset, setAppliedPreset] = useState<{ key: string; setup: Selection } | null>(null);
  const [runner, setRunner] = useState<RunnerConfig>(DEFAULT_RUNNER);
  const [tab, setTab] = useState<'skills' | 'characters'>('skills');
  const [showDev, setShowDev] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);

  const [computing, setComputing] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Computed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const cache = useRef(new Map<string, Computed>());
  const pool = useRef<RankingPool | null>(null);

  // Workers are created after mount: `output: 'export'` prerenders this page in
  // Node, where `Worker` does not exist. The pool itself spawns its threads lazily
  // on the first ranking.
  useEffect(() => {
    if (!workersSupported()) return;
    const created = new RankingPool();
    pool.current = created;
    return () => {
      created.dispose();
      if (pool.current === created) pool.current = null;
    };
  }, []);

  const course = resolveSelection(selection);

  const applyPreset = useCallback((next: Selection, key: string) => {
    setSelection(next);
    setAppliedPreset({ key, setup: next });
  }, []);

  /** The preset only counts as applied while every field it set still holds. */
  const appliedPresetKey = useMemo(() => {
    if (!appliedPreset) return null;
    const owned: (keyof Selection)[] = [
      'trackName',
      'surface',
      'distance',
      'courseId',
      'trackCondition',
      'weather',
      'season',
    ];
    // Deliberately not runningStyle: applying a preset never sets it, so changing it
    // must not clear the badge.
    return owned.every((k) => appliedPreset.setup[k] === selection[k]) ? appliedPreset.key : null;
  }, [appliedPreset, selection]);

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

    const key = computeKey(setup, runnerStats);
    const hit = cache.current.get(key);
    if (hit) {
      // Re-insert so the most recently used entry is the last to be evicted.
      cache.current.delete(key);
      cache.current.set(key, hit);
      setResult(hit);
      setComputing(false);
      setError(null);
      setProgress(null);
      return;
    }

    let cancelled = false;

    /** Assembles the final view from ranked rows, whichever path produced them. */
    const finish = (rows: RankedSkillView[], baselineFinishTime: number) => {
      const byId = new Map<number, TransportSkillEvaluation>();
      for (const r of rows) byId.set(r.skill.id, r.evaluation);
      const rankedCharacters = rankCharactersFrom(
        characters,
        skillsById,
        setup,
        runnerStats,
        (skill) => byId.get(skill.id) ?? null,
      );
      const computed: Computed = {
        rankedSkills: rows,
        rankedCharacters,
        baselineFinishTime,
      };
      cache.current.set(key, computed);
      while (cache.current.size > RESULT_CACHE_LIMIT) {
        const oldest = cache.current.keys().next();
        if (oldest.done) break;
        cache.current.delete(oldest.value);
      }
      if (cancelled) return;
      setResult(computed);
      setProgress(null);
      setComputing(false);
    };

    const fail = (e: unknown) => {
      if (cancelled) return;
      // A superseded job is not an error the user should see.
      if (e instanceof Error && e.message === 'superseded') return;
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
      setComputing(false);
    };

    // Trailing debounce. Dragging a stepper or retyping a stat used to submit every
    // intermediate value, and because the main thread was blocked the browser
    // replayed the buffered events, chaining the freezes end to end.
    const handle = setTimeout(() => {
      setComputing(true);
      setError(null);
      setProgress({ done: 0, total: skills.length });

      const onProgress = (done: number, total: number) => {
        if (!cancelled) setProgress({ done, total });
      };

      if (pool.current) {
        pool.current
          .run(setup, runnerStats, skills.length, onProgress)
          .then(({ rows, baselineFinishTimeSeconds }) => {
            if (cancelled) return;
            const view: RankedSkillView[] = [];
            for (const row of rows) {
              const skill = skillsById.get(row.skillId);
              if (skill) view.push({ skill, evaluation: row.evaluation });
            }
            view.sort(
              (a, b) => b.evaluation.expectedHorseLengths - a.evaluation.expectedHorseLengths,
            );
            finish(view, baselineFinishTimeSeconds);
          })
          .catch(fail);
        return;
      }

      // No Worker in this environment: run it inline, as before. Still blocking, but
      // correct - and this path is the reference the worker path is tested against.
      try {
        const { ranked, baseline } = rankSkills(skills, setup, runnerStats, onProgress);
        finish(ranked, baseline.baseline.finishTimeSeconds);
      } catch (e) {
        fail(e);
      }
    }, COMPUTE_DEBOUNCE_MS);

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
      <EventPresets
        selection={selection}
        appliedPresetKey={appliedPresetKey}
        onApply={applyPreset}
      />
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

      {computing && (
        <Spinner label="Running the race simulation for every Global skill..." progress={progress} />
      )}

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
