'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Panel({
  title,
  subtitle,
  children,
  right,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)]">
      {(title || right) && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--color-ink-dim)]">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Select<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: string) => void;
  options: { value: T; label: string; disabled?: boolean }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-[var(--color-ink-dim)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 2000,
  step = 10,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = useId();
  /**
   * A local draft, committed on a short idle or on blur / Enter.
   *
   * Raising this value re-runs the whole race simulation, so submitting every
   * intermediate keystroke was expensive and wrong: typing "1200" into an empty box
   * used to submit 0, 1, 12, 120 and 1200 - five full rankings, four of them
   * discarded, and the first of them a simulation of a 0-Speed runner, because
   * `Number('')` is 0. Holding a stepper arrow auto-repeats at ~30 Hz.
   *
   * Idle-commit rather than blur-only so the stepper arrows still feel live.
   */
  const [draft, setDraft] = useState(() => String(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the value when it changes from outside (the Reset button, a preset).
  useEffect(() => setDraft(String(value)), [value]);

  const commit = useCallback(
    (raw: string) => {
      const parsed = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(parsed)) return;
      // HTML number inputs do not clamp typed values, only stepped ones.
      const clamped = Math.min(max, Math.max(min, parsed));
      if (clamped !== value) onChange(clamped);
    },
    [max, min, onChange, value],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onDraft = (raw: string) => {
    setDraft(raw);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(raw), 400);
  };

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    commit(draft);
  };

  const pending = draft !== String(value);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-[var(--color-ink-dim)]">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter') flush();
          else if (e.key === 'Escape') {
            if (timer.current) clearTimeout(timer.current);
            setDraft(String(value));
          }
        }}
        aria-describedby={pending ? `${id}-pending` : undefined}
        className={`w-full rounded-md border bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] ${
          pending ? 'border-[var(--color-warn)]' : 'border-[var(--color-line)]'
        }`}
      />
      {pending && (
        <span id={`${id}-pending`} className="sr-only">
          Not applied yet. Press Enter or move focus away to apply.
        </span>
      )}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        checked
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
          : 'border-[var(--color-line)] bg-[var(--color-panel-2)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
      }`}
    >
      {label}
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'bad' | 'gold' | 'unique' | 'evolution';
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-[var(--color-line)] text-[var(--color-ink-dim)]',
    accent: 'border-[var(--color-accent)]/60 text-[var(--color-accent)]',
    warn: 'border-[var(--color-warn)]/60 text-[var(--color-warn)]',
    bad: 'border-[var(--color-bad)]/60 text-[var(--color-bad)]',
    gold: 'border-amber-400/60 text-amber-300',
    unique: 'border-fuchsia-400/60 text-fuchsia-300',
    evolution: 'border-sky-400/60 text-sky-300',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Accessible hover/focus tooltip that does not need a portal. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-64 -translate-x-1/2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-xs font-normal text-[var(--color-ink)] shadow-xl"
        >
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * Outbound link to a canonical GameTora page.
 *
 * Renders a real anchor (never a click handler on a non-interactive element) with
 * a visible external-link glyph. When `href` is missing the children are rendered
 * as plain text, so an item with no valid GameTora page is simply not clickable.
 */
export function ExternalLink({
  href,
  children,
  title,
  className = '',
}: {
  href?: string;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? 'Opens the GameTora page in a new tab'}
      className={`inline-flex items-baseline gap-1 underline decoration-dotted underline-offset-2 hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${className}`}
    >
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 self-center opacity-70"
      >
        <path d="M14 4h6v6" />
        <path d="M20 4 10 14" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
      <span className="sr-only"> (opens on GameTora in a new tab)</span>
    </a>
  );
}

export function Spinner({
  label,
  progress,
}: {
  label: string;
  /** When given, shows real progress instead of an indeterminate spinner. */
  progress?: { done: number; total: number } | null;
}) {
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;
  return (
    <div className="py-10 text-sm text-[var(--color-ink-dim)]" role="status">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-accent)]" />
        {label}
        {pct !== null && <span className="tabular-nums text-[var(--color-ink)]">{pct}%</span>}
      </div>
      {pct !== null && (
        <div
          className="mt-3 h-1 w-full max-w-md overflow-hidden rounded-full bg-[var(--color-panel-2)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress!.total}
          aria-valuenow={progress!.done}
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-[var(--color-ink-dim)]">{hint}</p>}
    </div>
  );
}

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--color-bad)]/50 bg-[var(--color-bad)]/10 p-4">
      <p className="text-sm font-semibold text-[var(--color-bad)]">{title}</p>
      {detail && <p className="mt-1 font-mono text-xs break-words text-[var(--color-ink-dim)]">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-[var(--color-line)] px-3 py-1 text-xs hover:border-[var(--color-accent)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
