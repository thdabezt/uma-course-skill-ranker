'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { rankCharacters, type RankedCharacter } from '@/analysis/characterRanking';
import { SAMPLES, deservesDetail, isAccelSkill, isSpeedSkill, selectAllAnalyzed, INNATE_RARITIES } from '@/analysis/rankSkills';
import { DEFAULT_SEED, DEFAULT_SIMULATION_OPTIONS, createAnalysisContext, reliabilityOf, staticSkillData, type SkillAnalysis } from '@/analysis/skillAnalysis';
import { analyzeMany } from '@/analysis/rankSkills';
import { AccelTab } from '@/components/AccelTab';
import { CharacterTab } from '@/components/CharacterTab';
import type { ActivationOverlay } from '@/components/CourseDiagram';
import { CourseSelector, defaultSelection, resolveSelection, type Selection } from '@/components/CourseSelector';
import { DevExcluded } from '@/components/DevExcluded';
import { EventPresets } from '@/components/EventPresets';
import { SpeedTab } from '@/components/SpeedTab';
import { StaminaTab, type StaminaView } from '@/components/StaminaTab';
import { TrackInfo } from '@/components/TrackInfo';
import { ErrorState, Select, Spinner, Toggle } from '@/components/ui';
import type { SkillRow } from '@/components/skillRows';
import { characters, dataMeta, skills, skillsById } from '@/data';
import type { SimulationOptions } from '@/engine/compare';
import { DEFAULT_RUNNER, RUNNING_STYLES, RUNNING_STYLE_LABELS, type RunnerConfig, type RunningStyle } from '@/simulation/config';
import type { RaceSetup, RunnerStats, Skill } from '@/simulation/types';
import { conditionNames } from '@/skills/conditionParser';
import { AnalysisPool, workersSupported } from '@/worker/analysisPool';
import type { AnalysisRow } from '@/worker/analysisProtocol';

/** Conditions that make a passive skill "course related" for the track panel. */
const COURSE_CONDITIONS = new Set([
  'rotation',
  'ground_type',
  'distance_type',
  'track_id',
  'is_basis_distance',
  'is_dirtgrade',
  'season',
  'weather',
  'ground_condition',
  'course_distance',
]);

type Tab = 'speed' | 'accel' | 'characters' | 'stamina';

const TAB_LABELS: Record<Tab, string> = {
  speed: 'Speed skills',
  accel: 'Acceleration skills',
  characters: 'Character ranking',
  stamina: 'Stamina calculation',
};

/** Trailing debounce before an analysis starts. */
const COMPUTE_DEBOUNCE_MS = 300;
const RESULT_CACHE_LIMIT = 4;

type Stage = 'screening' | 'detail' | 'done';

interface Computed {
  analyses: Map<number, SkillAnalysis>;
  stage: Stage;
}

function computeKey(setup: RaceSetup, runner: RunnerStats, options: SimulationOptions): string {
  return JSON.stringify([setup.course.id, setup.trackCondition, setup.weather, setup.season, runner, options]);
}

const analyzedSkills = selectAllAnalyzed(skills);
const analyzedIds = analyzedSkills.map((s) => s.id);

export default function Page() {
  const [selection, setSelection] = useState<Selection>(() => defaultSelection());
  const [appliedPreset, setAppliedPreset] = useState<{ key: string; setup: Selection } | null>(null);
  const [runner, setRunner] = useState<RunnerConfig>(DEFAULT_RUNNER);
  const [options, setOptions] = useState<SimulationOptions>(DEFAULT_SIMULATION_OPTIONS);
  const [tab, setTab] = useState<Tab>('speed');
  const [showDev, setShowDev] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);

  const [computed, setComputed] = useState<Computed | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [forceFullSpurt, setForceFullSpurt] = useState(true);
  const [staminaSkillIds, setStaminaSkillIds] = useState<number[]>([]);
  const [stamina, setStamina] = useState<StaminaView | null>(null);
  const [staminaComputing, setStaminaComputing] = useState(false);
  const [staminaError, setStaminaError] = useState<string | null>(null);

  const cache = useRef(new Map<string, Computed>());
  const pool = useRef<AnalysisPool | null>(null);

  // Workers are created after mount: `output: 'export'` prerenders this page in
  // Node, where `Worker` does not exist.
  useEffect(() => {
    if (!workersSupported()) return;
    const created = new AnalysisPool();
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

  const appliedPresetKey = useMemo(() => {
    if (!appliedPreset) return null;
    const owned: (keyof Selection)[] = ['trackName', 'surface', 'distance', 'courseId', 'trackCondition', 'weather', 'season'];
    return owned.every((k) => appliedPreset.setup[k] === selection[k]) ? appliedPreset.key : null;
  }, [appliedPreset, selection]);

  const setup: RaceSetup | null = useMemo(
    () =>
      course
        ? {
            course,
            runningStyle: runner.runningStyle,
            trackCondition: selection.trackCondition,
            weather: selection.weather,
            season: selection.season,
          }
        : null,
    [course, runner.runningStyle, selection.trackCondition, selection.weather, selection.season],
  );

  const runnerStats: RunnerStats = runner;

  /* ------------------------------------------------------------ analysis */
  useEffect(() => {
    if (!setup) {
      setError('The selected racecourse could not be found in the Global data set.');
      return;
    }
    const key = computeKey(setup, runnerStats, options);
    const hit = cache.current.get(key);
    if (hit) {
      cache.current.delete(key);
      cache.current.set(key, hit);
      setComputed(hit);
      setError(null);
      setProgress(null);
      return;
    }

    let cancelled = false;
    const analyses = new Map<number, SkillAnalysis>();
    const publish = (stage: Stage) => {
      if (cancelled) return;
      const snapshot: Computed = { analyses: new Map(analyses), stage };
      setComputed(snapshot);
      if (stage === 'done') {
        cache.current.set(key, snapshot);
        while (cache.current.size > RESULT_CACHE_LIMIT) {
          const oldest = cache.current.keys().next();
          if (oldest.done) break;
          cache.current.delete(oldest.value);
        }
      }
    };
    const absorb = (rows: AnalysisRow[]) => {
      for (const r of rows) analyses.set(r.skillId, r.analysis);
    };
    const fail = (e: unknown) => {
      if (cancelled) return;
      if (e instanceof Error && e.message === 'superseded') return;
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    };

    const handle = setTimeout(() => {
      setError(null);
      setProgress({ done: 0, total: analyzedIds.length });
      const p = pool.current;
      if (p) {
        p.run({
          setup,
          runner: runnerStats,
          options,
          seed: DEFAULT_SEED,
          skillIds: analyzedIds,
          samples: SAMPLES.screening,
          onProgress: (done, total) => !cancelled && setProgress({ done, total }),
          onRows: (rows) => {
            absorb(rows);
            publish('screening');
          },
        })
          .then((rows) => {
            if (cancelled) return;
            const detailIds = rows.filter((r) => deservesDetail(r.analysis)).map((r) => r.skillId);
            setProgress({ done: 0, total: detailIds.length });
            publish('detail');
            return p.run({
              setup,
              runner: runnerStats,
              options,
              seed: DEFAULT_SEED,
              skillIds: detailIds,
              samples: SAMPLES.detail,
              onProgress: (done, total) => !cancelled && setProgress({ done, total }),
              onRows: (rows2) => {
                absorb(rows2);
                publish('detail');
              },
            });
          })
          .then(() => {
            if (cancelled) return;
            setProgress(null);
            publish('done');
          })
          .catch(fail);
        return;
      }
      // No Worker: run inline (blocking) with the detail sample count directly.
      try {
        const ctx = createAnalysisContext(setup, runnerStats, options, DEFAULT_SEED);
        const rows = analyzeMany(ctx, analyzedSkills, SAMPLES.screening);
        for (const r of rows) analyses.set(r.skillId, r.analysis);
        setProgress(null);
        publish('done');
      } catch (e) {
        fail(e);
      }
    }, COMPUTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [setup, runnerStats, options, attempt]);

  /* ------------------------------------------------------------- stamina */
  useEffect(() => {
    if (!setup || tab !== 'stamina') return;
    const p = pool.current;
    if (!p) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setStaminaComputing(true);
      setStaminaError(null);
      const sweep = [-400, -200, -100, 0, 100, 200, 400].map((d) => Math.max(100, runner.stamina + d));
      p.runStamina(
        {
          setup,
          runner: runnerStats,
          options: { ...options, forceFullSpurt },
          skills: staminaSkillIds.map((id) => ({ id: String(id) })),
          samples: 300,
        },
        sweep,
      )
        .then((outcome) => {
          if (cancelled) return;
          setStamina(outcome);
          setStaminaComputing(false);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof Error && e.message === 'superseded') return;
          setStaminaError(e instanceof Error ? e.message : String(e));
          setStaminaComputing(false);
        });
    }, COMPUTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [setup, runnerStats, options, forceFullSpurt, staminaSkillIds, tab, runner.stamina]);

  /* ---------------------------------------------------------- derived */
  const greenSkills = useMemo(() => {
    if (!setup) return [];
    const ctx = createAnalysisContext(setup, runnerStats, options, DEFAULT_SEED);
    return skills
      .filter((s) => s.isPassive && s.conditionGroups.some((g) => conditionNames(g.condition).some((n) => COURSE_CONDITIONS.has(n))))
      .filter((s) => reliabilityOf(s, staticSkillData(ctx, s)) !== 'never')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [setup, runnerStats, options]);

  const rowsFor = useCallback(
    (predicate: (s: Skill) => boolean): SkillRow[] => {
      if (!computed) return [];
      const out: SkillRow[] = [];
      for (const s of analyzedSkills) {
        if (!predicate(s) || INNATE_RARITIES.has(s.rarity)) continue;
        const a = computed.analyses.get(s.id);
        if (a) out.push({ skill: s, analysis: a });
      }
      return out;
    },
    [computed],
  );
  const speedRows = useMemo(() => rowsFor(isSpeedSkill), [rowsFor]);
  const accelRows = useMemo(() => rowsFor(isAccelSkill), [rowsFor]);

  const rankedCharacters: RankedCharacter[] = useMemo(() => {
    if (!setup || !computed) return [];
    return rankCharacters(characters, skillsById, setup, runnerStats, (id) => computed.analyses.get(id) ?? null);
  }, [setup, computed, runnerStats]);

  const overlay: ActivationOverlay | null = useMemo(() => {
    if (!computed || selectedSkillId == null || !course) return null;
    const a = computed.analyses.get(selectedSkillId);
    const skill = skillsById.get(selectedSkillId);
    if (!a || !skill || !a.activation) return null;
    const end = Math.min(course.distance, a.activation.meanEnd);
    return {
      skillName: skill.name,
      windows: a.region ? [{ start: a.region.start, end: Math.min(course.distance, a.region.end) }] : [],
      samples: a.activation.starts.slice(0, 80),
      effective: end > a.activation.meanStart ? [{ start: a.activation.meanStart, end }] : [],
      wasted: a.timing.cutByFinishShare > 0.5 ? [{ start: course.distance, end: course.distance + course.distance * 0.02 }] : [],
    };
  }, [computed, selectedSkillId, course]);

  const staminaCandidates = useMemo(() => skills.filter((s) => !s.isDebuff && !INNATE_RARITIES.has(s.rarity)).sort((a, b) => a.name.localeCompare(b.name)), []);

  const stageLabel =
    computed?.stage === 'screening'
      ? 'Screening every skill (24 races each)...'
      : computed?.stage === 'detail'
        ? 'Refining the skills that matter (120 races each)...'
        : null;

  return (
    <main className="mx-auto w-full max-w-[110rem] space-y-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Uma Musume Course Skill Ranker</h1>
          <p className="mt-1 text-xs text-[var(--color-ink-dim)]">
            Global (EN) data only. Every number comes from paired race simulations with the uma-tools engine (the calculator behind umalator).
          </p>
        </div>
        <Toggle label="Developer view" checked={showDev} onChange={setShowDev} />
      </header>

      <CourseSelector selection={selection} onChange={setSelection} />
      <EventPresets selection={selection} appliedPresetKey={appliedPresetKey} onApply={applyPreset} />

      {course && <TrackInfo course={course} runner={runner} greenSkills={greenSkills} overlay={overlay} />}

      {error && <ErrorState title="The analysis could not be computed" detail={error} onRetry={() => setAttempt((a) => a + 1)} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md border px-3 py-1.5 text-sm ${tab === t ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent)]'}`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        {tab !== 'stamina' && (
          <div className="flex flex-wrap items-end gap-3 text-xs text-[var(--color-ink-dim)]">
            <Select
              label="Running style"
              value={runner.runningStyle}
              onChange={(v) => setRunner({ ...runner, runningStyle: v as RunningStyle })}
              options={RUNNING_STYLES.map((s) => ({ value: s, label: RUNNING_STYLE_LABELS[s] }))}
            />
            <span className="pb-2">
              Build {runner.speed} / {runner.stamina} / {runner.power} / {runner.guts} / {runner.wit}, edit in the Stamina tab.
            </span>
          </div>
        )}
      </div>

      {stageLabel && tab !== 'stamina' && <Spinner label={stageLabel} progress={progress} />}
      {!computed && !error && tab !== 'stamina' && <Spinner label="Starting the race simulations..." progress={progress} />}

      {computed && course && tab === 'speed' && (
        <SpeedTab rows={speedRows} courseDistance={course.distance} selectedSkillId={selectedSkillId} onSelect={setSelectedSkillId} />
      )}
      {computed && course && tab === 'accel' && (
        <AccelTab rows={accelRows} courseDistance={course.distance} selectedSkillId={selectedSkillId} onSelect={setSelectedSkillId} />
      )}
      {computed && course && tab === 'characters' && (
        <CharacterTab ranked={rankedCharacters} runningStyle={runner.runningStyle} courseDistance={course.distance} evolutionAvailable={dataMeta.evolutionSkillsAvailableOnGlobal} />
      )}
      {tab === 'stamina' && (
        <StaminaTab
          runner={runner}
          onRunnerChange={setRunner}
          options={options}
          onOptionsChange={setOptions}
          forceFullSpurt={forceFullSpurt}
          onForceFullSpurtChange={setForceFullSpurt}
          candidateSkills={staminaCandidates}
          selectedSkillIds={staminaSkillIds}
          onSelectedSkillsChange={setStaminaSkillIds}
          view={stamina}
          computing={staminaComputing}
          error={staminaError}
        />
      )}

      {showDev && <DevExcluded />}

      <footer className="space-y-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-xs text-[var(--color-ink-dim)]">
        <p>
          <strong className="text-[var(--color-ink)]">Calculation:</strong> the race model is the GPL-licensed engine from{' '}
          <a href="https://github.com/alpha123/uma-tools" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline">
            alpha123/uma-tools
          </a>
          , the simulator behind umalator, ported with the mechanics of the deployed Global build (spot struggle, rushing, downhill mode, Fully Charged, unique level scaling). A skill&apos;s value is the gap, in horse lengths, between the same seeded race with and without it.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Data source:</strong> skill, character and racecourse data is derived from the public static JSON that{' '}
          <a href={dataMeta.source.homepage} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline">
            {dataMeta.source.name}
          </a>{' '}
          publishes for its own site, enriched with engine metadata from uma-tools. Fetched {new Date(dataMeta.dataFetchedAt).toUTCString()}; normalized {new Date(dataMeta.generatedAt).toUTCString()}.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Scope:</strong> {dataMeta.counts.courses} racecourses, {dataMeta.counts.skills} skills and {dataMeta.counts.characters} characters released on the Global server.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Disclaimer:</strong> a solo simulation with a synthetic pacer; everything that depends on other runners is modelled statistically. Uma Musume: Pretty Derby is the property of Cygames; this project is unaffiliated with Cygames, GameTora and uma-tools.
        </p>
      </footer>
    </main>
  );
}
