'use client';

import { memo } from 'react';

import { DEFAULT_RUNNER, type Aptitude, type Mood, type RunnerConfig } from '@/simulation/config';
import { NumberField, Panel, Select } from './ui';

const APTITUDES: Aptitude[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const MOODS: Mood[] = ['great', 'good', 'normal', 'bad', 'awful'];
const MOOD_LABELS: Record<Mood, string> = {
  great: 'Great',
  good: 'Good',
  normal: 'Normal',
  bad: 'Bad',
  awful: 'Awful',
};

function RunnerPanelImpl({
  runner,
  onChange,
}: {
  runner: RunnerConfig;
  onChange: (r: RunnerConfig) => void;
}) {
  // Every one of these allocates a new runner object, and a new object identity is
  // what re-runs the whole ranking. Drop no-op writes at the source.
  const set = <K extends keyof RunnerConfig>(key: K, value: RunnerConfig[K]) => {
    if (runner[key] === value) return;
    onChange({ ...runner, [key]: value });
  };

  const isDefault = (Object.keys(DEFAULT_RUNNER) as (keyof RunnerConfig)[]).every(
    (k) => k === 'runningStyle' || runner[k] === DEFAULT_RUNNER[k],
  );

  return (
    <Panel
      title="Reference runner"
      subtitle="Every horse-length figure is measured against this build. Defaults live in src/simulation/config.ts"
      right={
        <button
          type="button"
          disabled={isDefault}
          onClick={() => onChange({ ...DEFAULT_RUNNER, runningStyle: runner.runningStyle })}
          className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs enabled:hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to defaults
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <NumberField label="Speed" value={runner.speed} onChange={(v) => set('speed', v)} max={1800} />
        <NumberField label="Stamina" value={runner.stamina} onChange={(v) => set('stamina', v)} max={1800} />
        <NumberField label="Power" value={runner.power} onChange={(v) => set('power', v)} max={1800} />
        <NumberField label="Guts" value={runner.guts} onChange={(v) => set('guts', v)} max={1800} />
        <NumberField label="Wit" value={runner.wit} onChange={(v) => set('wit', v)} max={1800} />

        <Select
          label="Mood"
          value={runner.mood}
          onChange={(v) => set('mood', v as Mood)}
          options={MOODS.map((m) => ({ value: m, label: MOOD_LABELS[m] }))}
        />
        <Select
          label="Distance aptitude"
          value={runner.distanceAptitude}
          onChange={(v) => set('distanceAptitude', v as Aptitude)}
          options={APTITUDES.map((a) => ({ value: a, label: a }))}
        />
        <Select
          label="Surface aptitude"
          value={runner.surfaceAptitude}
          onChange={(v) => set('surfaceAptitude', v as Aptitude)}
          options={APTITUDES.map((a) => ({ value: a, label: a }))}
        />
        <Select
          label="Running-style aptitude"
          value={runner.styleAptitude}
          onChange={(v) => set('styleAptitude', v as Aptitude)}
          options={APTITUDES.map((a) => ({ value: a, label: a }))}
        />
        <NumberField
          label="Gate number"
          value={runner.postNumber}
          onChange={(v) => set('postNumber', v)}
          min={1}
          max={18}
          step={1}
        />
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-dim)]">
        Skill activation intelligence, field size, assumed running position and every other probability
        assumption are documented in <code className="text-[var(--color-accent)]">src/simulation/config.ts</code>.
      </p>
    </Panel>
  );
}

/**
 * Memoized: the page re-renders on every ranking progress tick and on every skill
 * row expansion, and none of that changes this panel's props.
 */
export const RunnerPanel = memo(RunnerPanelImpl);
