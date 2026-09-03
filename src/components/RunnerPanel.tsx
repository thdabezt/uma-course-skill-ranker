'use client';

import { memo } from 'react';

import type { SimulationOptions } from '@/engine/compare';
import {
  APTITUDES,
  DEFAULT_RUNNER,
  MOODS,
  MOOD_LABELS,
  RUNNING_STYLES,
  RUNNING_STYLE_LABELS,
  type Aptitude,
  type Mood,
  type RunnerConfig,
  type RunningStyle,
} from '@/simulation/config';
import { NumberField, Panel, Select, Toggle, Tooltip } from './ui';

function RunnerPanelImpl({
  runner,
  onChange,
  options,
  onOptionsChange,
}: {
  runner: RunnerConfig;
  onChange: (r: RunnerConfig) => void;
  options: SimulationOptions;
  onOptionsChange: (o: SimulationOptions) => void;
}) {
  // Every write allocates a new runner object, and a new identity re-runs every
  // simulation. Drop no-op writes at the source.
  const set = <K extends keyof RunnerConfig>(key: K, value: RunnerConfig[K]) => {
    if (runner[key] === value) return;
    onChange({ ...runner, [key]: value });
  };

  const isDefault = (Object.keys(DEFAULT_RUNNER) as (keyof RunnerConfig)[]).every((k) => runner[k] === DEFAULT_RUNNER[k]);
  const frontRunner = runner.runningStyle === 'front_runner';

  return (
    <Panel
      title="Runner build"
      subtitle="Every figure on this site is simulated for this build. Stats are the displayed (pre-race) values."
      right={
        <button
          type="button"
          disabled={isDefault}
          onClick={() => onChange({ ...DEFAULT_RUNNER })}
          className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs enabled:hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to defaults
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <NumberField label="Speed" value={runner.speed} onChange={(v) => set('speed', v)} max={2000} />
        <NumberField label="Stamina" value={runner.stamina} onChange={(v) => set('stamina', v)} max={2000} />
        <NumberField label="Power" value={runner.power} onChange={(v) => set('power', v)} max={2000} />
        <NumberField label="Guts" value={runner.guts} onChange={(v) => set('guts', v)} max={2000} />
        <NumberField label="Wit" value={runner.wit} onChange={(v) => set('wit', v)} max={2000} />

        <Select
          label="Running style"
          value={runner.runningStyle}
          onChange={(v) => set('runningStyle', v as RunningStyle)}
          options={RUNNING_STYLES.map((s) => ({ value: s, label: RUNNING_STYLE_LABELS[s] }))}
        />
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
          label="Style aptitude"
          value={runner.styleAptitude}
          onChange={(v) => set('styleAptitude', v as Aptitude)}
          options={APTITUDES.map((a) => ({ value: a, label: a }))}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--color-ink-dim)]">Race mechanics</span>
        <Toggle
          label="Position keep (pace down behind a front runner)"
          checked={options.usePosKeep}
          onChange={(v) => onOptionsChange({ ...options, usePosKeep: v })}
          title="Non front runners hold formation behind the leader for the opening sections, running slower and burning 40% less stamina. Front runners are not affected."
        />
        <Toggle
          label={frontRunner ? 'Spot struggle (fight for the lead)' : 'Spot struggle (front runners only)'}
          checked={options.useCompeteTop}
          onChange={(v) => onOptionsChange({ ...options, useCompeteTop: v })}
          title="Front runners fight for the lead early in the race: a Guts-based speed boost that costs a lot of stamina (1.4x drain, 3.6x while rushed)."
        />
        <Toggle
          label="Assume position from style"
          checked={options.assumePosition !== false}
          onChange={(v) => onOptionsChange({ ...options, assumePosition: v })}
          title="Skills that require a running position (1st, top 40%, ...) are judged against the position a runner of this style usually holds: front runner 1st, pace chaser 2nd-4th, late surger and end closer 5th-9th of 9 (umalator's rule). Off (default) = position conditions are treated as reachable by any style, so every working skill is shown."
        />
        <Toggle
          label="Wit activation checks"
          checked={options.useIntChecks}
          onChange={(v) => onOptionsChange({ ...options, useIntChecks: v })}
          title="Roll the Wit-based activation chance for every skill (max(1 - 90 / Wit, 20%)). Off = every skill whose conditions hold fires."
        />
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-dim)]">
        <Tooltip label="Defaults follow umalator-global: 1600 / 1300 / 1100 / 800 / 1100, Great mood, S distance, position keep and spot struggle on, Wit checks off. Rushing and downhill mode are always simulated from Wit; Fully Charged (Power above 1200) is applied automatically.">
          <span className="cursor-help underline decoration-dotted">What is simulated?</span>
        </Tooltip>
      </p>
    </Panel>
  );
}

export const RunnerPanel = memo(RunnerPanelImpl);
