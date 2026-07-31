/**
 * Race simulation for the Global (EN) version.
 *
 * Fixed timestep, velocity-Verlet integration, seeded randomness. Mechanics were
 * derived by studying the behaviour of the Global reference simulator
 * (alpha123/uma-tools, GPL-3.0) and reimplemented independently - see
 * `./globalVersion.ts` for the provenance record and the Global-vs-Japan
 * differences that are deliberately modelled the Global way.
 *
 * Every constant lives in `./config.ts`.
 */

import {
  DISTANCE_APTITUDE_ACCEL,
  DISTANCE_APTITUDE_SPEED,
  MOOD_MULTIPLIER,
  SIMULATION,
  STRATEGY_HP,
  STRATEGY_PHASE_ACCEL,
  STRATEGY_PHASE_SPEED,
  STYLE_APTITUDE_WIT,
  SURFACE_APTITUDE_ACCEL,
  TRACK_CONDITION_MODIFIERS,
  witSkillProcRate,
} from './config';
import { createRng, seedFor, type Rng } from './random';
import {
  createEventHistory,
  soloRelativeState,
  updateRelativeState,
  type RaceEventHistory,
  type RaceRelativeState,
} from './raceEvents';
import { RACE_FIELD } from './config';
import type {
  ConditionContext,
  Course,
  RaceSetup,
  RunnerStats,
  ScheduledEffect,
  SimulationResult,
} from './types';

/* ------------------------------------------------------------------ stats */

export interface EffectiveStats {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wit: number;
  /** Stamina before the course/ground adjustments, used by max-HP. */
  rawStamina: number;
}

/** Stats above the cap contribute at half rate. */
export function applyOvercap(stat: number): number {
  const cap = SIMULATION.statOvercapThreshold;
  return stat > cap ? cap + Math.floor((stat - cap) / 2) : stat;
}

/**
 * Course "stat check" bonus. A course that highlights one or more stats gives a
 * Speed multiplier that steps up every 300 points of the highlighted stat.
 */
export function courseSpeedModifier(course: Course, stats: { [k: string]: number }): number {
  const thresholds = course.statThresholds ?? [];
  if (thresholds.length === 0) return 1;
  const value = (name: string) =>
    Math.min(stats[name === 'wit' ? 'wit' : name] ?? 0, SIMULATION.courseStatThresholdCap);
  const total = thresholds.reduce(
    (sum, stat) =>
      sum + (1 + Math.floor(value(stat) / SIMULATION.courseStatThresholdStep)) * SIMULATION.courseStatThresholdBonus,
    0,
  );
  return 1 + total / Math.max(thresholds.length, 1);
}

/**
 * Applies, in order: over-cap halving, mood, the course stat bonus (Speed only),
 * the track-condition flat modifiers, and the running-style aptitude (Wit only).
 *
 * Note what does NOT happen here: surface aptitude does not scale Speed or Power
 * (it scales acceleration), and running-style aptitude does not scale acceleration.
 */
export function effectiveStats(runner: RunnerStats, setup: RaceSetup): EffectiveStats {
  const mood = MOOD_MULTIPLIER[runner.mood];
  const cond = TRACK_CONDITION_MODIFIERS[setup.course.surface][setup.trackCondition];

  const base = {
    speed: applyOvercap(runner.speed) * mood,
    stamina: applyOvercap(runner.stamina) * mood,
    power: applyOvercap(runner.power) * mood,
    guts: applyOvercap(runner.guts) * mood,
    wit: applyOvercap(runner.wit) * mood,
  };

  const courseModifier = courseSpeedModifier(setup.course, base);

  return {
    speed: Math.max(1, base.speed * courseModifier + cond.speed),
    stamina: base.stamina,
    rawStamina: runner.stamina * mood,
    power: Math.max(1, base.power + cond.power),
    guts: base.guts,
    wit: Math.max(1, base.wit * STYLE_APTITUDE_WIT[runner.styleAptitude]),
  };
}

export function baseSpeedOf(distance: number): number {
  return (
    SIMULATION.baseSpeedAtReferenceDistance -
    (distance - SIMULATION.baseSpeedReferenceDistance) * SIMULATION.baseSpeedPerMeter
  );
}

export function maxHpOf(runner: RunnerStats, setup: RaceSetup, stats: EffectiveStats): number {
  return (
    setup.course.distance +
    SIMULATION.hpStaminaCoefficient * STRATEGY_HP[runner.runningStyle] * stats.stamina
  );
}

/** Phase boundaries come from the distance, not from the drawn course sections. */
export function phaseStart(distance: number, phase: number): number {
  switch (phase) {
    case 0:
      return 0;
    case 1:
      return distance / 6;
    case 2:
      return (distance * 2) / 3;
    default:
      return (distance * 5) / 6;
  }
}

/* --------------------------------------------------------------- options */

export interface SimulationOptions {
  /** Seed for this run. Paired runs must share it. */
  seed: number;
  /** Skip the Wit proc roll (used when a skill's activation is evaluated separately). */
  forceSkillActivation?: boolean;
  /** Record position/time samples so a finish comparison can interpolate. */
  recordTrace?: boolean;
  /**
   * Pre-simulated opponent trajectories. Supplying them turns on rank, overtake
   * and nearby-runner tracking. They are identical between a baseline run and a
   * with-skill run, which is what makes the paired comparison valid.
   */
  opponentPositionsAt?: (t: number) => number[];
  /** Frame-indexed variant; preferred when available because it avoids a search. */
  opponentPositionsAtFrame?: (frame: number) => number[];
}

interface ActiveEffect {
  skillId: number;
  endsAt: number;
  targetSpeed: number;
  acceleration: number;
  currentSpeed: number;
  /** Type 22 gives the velocity offset back as a one-frame acceleration. */
  naturalDeceleration: boolean;
}

const scale = (raw: number) => raw / SIMULATION.effectValueScale;

/* ------------------------------------------------------------ last spurt */

interface SpurtPlan {
  /** Position at which the spurt begins, or -1 for "as soon as the final leg starts". */
  transition: number;
  speed: number;
}

/**
 * Decides how the runner spends its remaining stamina over the final leg.
 *
 * If the full-speed spurt is affordable it is taken. Otherwise the runner
 * considers progressively slower spurts, each starting later, ordered by the total
 * time they would produce, and accepts one with a Wit-driven probability - so a
 * low-Wit runner more often settles for a worse plan.
 */
function planLastSpurt(args: {
  hp: number;
  position: number;
  distance: number;
  maxSpeed: number;
  cruiseSpeed: number;
  hpPerSecond: (v: number) => number;
  rng: Rng;
  wit: number;
}): SpurtPlan {
  const { hp, position, distance, maxSpeed, cruiseSpeed, hpPerSecond, rng, wit } = args;
  const tail = SIMULATION.lastSpurtTailMeters;

  const fullSpurtDistance = distance - phaseStart(distance, 2) - tail;
  if (hp >= hpPerSecond(maxSpeed) * (fullSpurtDistance / maxSpeed)) {
    return { transition: -1, speed: maxSpeed };
  }

  const remaining = distance - tail - position;
  const candidates: SpurtPlan[] = [];
  for (let v = maxSpeed - SIMULATION.lastSpurtSearchStep; v >= cruiseSpeed; v -= SIMULATION.lastSpurtSearchStep) {
    // Split the remaining distance between `v` and the cruise speed so the stamina
    // budget is exactly spent, then start the fast part late enough to fit.
    const denominator = cruiseSpeed * hpPerSecond(v) - hpPerSecond(cruiseSpeed) * v;
    const spurtSeconds = Math.min(
      remaining / v,
      Math.max(0, denominator === 0 ? 0 : (cruiseSpeed * hp - hpPerSecond(cruiseSpeed) * remaining) / denominator),
    );
    candidates.push({ transition: distance - spurtSeconds * v, speed: v });
  }
  if (candidates.length === 0) return { transition: -1, speed: cruiseSpeed };

  const totalTime = (c: SpurtPlan) =>
    (c.transition - position) / cruiseSpeed + (distance - c.transition) / c.speed;
  candidates.sort((a, b) => totalTime(a) - totalTime(b));

  const acceptChance =
    (SIMULATION.spurtAcceptBase + SIMULATION.spurtAcceptWisdomCoefficient * wit) / 100;
  for (const candidate of candidates) {
    if (rng.next() <= acceptChance) return candidate;
  }
  return candidates[candidates.length - 1];
}

/* ---------------------------------------------------------------- solver */

export function simulateRace(
  setup: RaceSetup,
  runner: RunnerStats,
  planned: ScheduledEffect[] = [],
  options: SimulationOptions = { seed: 0 },
): SimulationResult {
  const { course } = setup;
  const distance = course.distance;
  const dt = SIMULATION.frameSeconds;
  const stats = effectiveStats(runner, setup);
  const baseSpeed = baseSpeedOf(distance);

  // Independent streams so adding a skill cannot shift unrelated random draws.
  const startRng = createRng(seedFor(options.seed, 'start'));
  const sectionRng = createRng(seedFor(options.seed, 'section'));
  const spurtRng = createRng(seedFor(options.seed, 'spurt'));
  const procRng = createRng(seedFor(options.seed, 'proc'));

  const styleSpeed = STRATEGY_PHASE_SPEED[runner.runningStyle];
  const styleAccel = STRATEGY_PHASE_ACCEL[runner.runningStyle];
  const distAptSpeed = DISTANCE_APTITUDE_SPEED[runner.distanceAptitude];
  const distAptAccel = DISTANCE_APTITUDE_ACCEL[runner.distanceAptitude];
  const surfaceAptAccel = SURFACE_APTITUDE_ACCEL[runner.surfaceAptitude];
  const groundHpMultiplier = TRACK_CONDITION_MODIFIERS[course.surface][setup.trackCondition].hpDrain;

  /* ---- mutable stat block (green skills can change it mid-race) ---- */
  let speedStat = stats.speed;
  let powerStat = stats.power;
  let gutsStat = stats.guts;
  let witStat = stats.wit;
  let staminaStat = stats.stamina;

  const procRate =
    runner.skillActivationRate == null ? witSkillProcRate(witStat) : runner.skillActivationRate;

  /* ---- speed model ---- */
  const cruiseSpeed = (phase: number) =>
    baseSpeed * styleSpeed[Math.min(phase, 2)] +
    (phase >= 2 ? Math.sqrt(500 * speedStat) * distAptSpeed * SIMULATION.lateSpeedStatCoefficient : 0);

  const spurtTopSpeed = () => {
    let v =
      (cruiseSpeed(2) + SIMULATION.lastSpurtBaseSpeedBonus * baseSpeed) * SIMULATION.lastSpurtMultiplier +
      Math.sqrt(500 * speedStat) * distAptSpeed * SIMULATION.lateSpeedStatCoefficient;
    if (SIMULATION.lastSpurtIncludesGutsBonus) {
      v += Math.pow(450 * gutsStat, 0.597) * 0.0001;
    }
    return v;
  };

  const minSpeedOf = () =>
    SIMULATION.minSpeedBaseRatio * baseSpeed +
    Math.sqrt(SIMULATION.minSpeedGutsCoefficient * gutsStat) * SIMULATION.minSpeedGutsScale;

  const accelOf = (phase: number, uphill: boolean) =>
    (uphill ? SIMULATION.uphillAccelerationPowerCoefficient : SIMULATION.accelerationPowerCoefficient) *
    Math.sqrt(500 * powerStat) *
    styleAccel[Math.min(phase, 2)] *
    surfaceAptAccel *
    distAptAccel;

  /* ---- stamina model ---- */
  let maxHp = maxHpOf(runner, setup, stats);
  let hp = maxHp;
  const gutsHpModifier = () =>
    1 + SIMULATION.gutsHpModNumerator / Math.sqrt(SIMULATION.gutsHpModCoefficient * gutsStat);
  const hpPerSecond = (v: number, phase: number, paceDown: boolean) =>
    ((SIMULATION.hpDrainCoefficient * Math.pow(v - baseSpeed + SIMULATION.hpDrainOffset, 2)) /
      SIMULATION.hpDrainDivisor) *
    (paceDown ? SIMULATION.paceDownHpDrainMultiplier : 1) *
    groundHpMultiplier *
    (phase >= 2 ? gutsHpModifier() : 1);

  /* ---- Wit per-section target-speed variance ---- */
  const sectionCount = SIMULATION.witSectionCount;
  const sectionLength = distance / sectionCount;
  const witMax = (witStat / SIMULATION.witVarianceDivisor) * Math.log10(witStat * SIMULATION.witVarianceLogScale);
  const sectionModifier = Array.from({ length: sectionCount + 1 }, (_, i) => {
    if (i === sectionCount) return 0;
    const factor = (witMax - SIMULATION.witVarianceSpread + sectionRng.next() * SIMULATION.witVarianceSpread) / 100;
    return baseSpeed * factor;
  });

  /* ---- slopes (pre-sorted, walked in order) ---- */
  const slopes = [
    ...course.uphills.map((s) => ({ ...s, uphill: true })),
    ...course.downhills.map((s) => ({ ...s, uphill: false })),
  ].sort((a, b) => a.start - b.start);
  const uphillAt = (pos: number) => slopes.find((s) => s.uphill && pos >= s.start && pos < s.end) ?? null;

  /* ---- state ---- */
  let position = 0;
  let time = 0;
  let currentSpeed: number = SIMULATION.startingSpeed;
  let phase: number = 0;
  let startDash = true;
  let isLastSpurt = false;
  let spurt: SpurtPlan | null = null;
  let minHpFraction = 1;
  let ranOutOfStamina = false;

  const startDelay = runner.startDelaySeconds > 0
    ? runner.startDelaySeconds
    : startRng.next() * SIMULATION.startDelayMaxSeconds;

  /* ---- opponents / relative state ---- */
  const byFrame = options.opponentPositionsAtFrame;
  const hasOpponents = typeof byFrame === 'function' || typeof options.opponentPositionsAt === 'function';
  const opponentsAtFrame = (frame: number, t: number): number[] =>
    byFrame ? byFrame(frame) : options.opponentPositionsAt!(t);
  const fieldSize = hasOpponents ? opponentsAtFrame(0, 0).length + 1 : RACE_FIELD.fieldSize;
  const eventHistory: RaceEventHistory = createEventHistory(fieldSize);
  const previousOpponentPositions: number[] = hasOpponents ? opponentsAtFrame(0, 0).slice() : [];
  let previousPlayerPosition = 0;
  let relative: RaceRelativeState = hasOpponents
    ? soloRelativeState(fieldSize, fieldSize)
    : soloRelativeState(RACE_FIELD.assumedOrder[runner.runningStyle], fieldSize);

  /* ---- position keeping (pace down) ---- */
  const paceDownEligible =
    SIMULATION.positionKeepEnabled && runner.runningStyle !== 'front_runner';
  const positionKeepEnd = sectionLength * SIMULATION.positionKeepSections;
  let paceDownActive = false;

  /* ---- effects ---- */
  const queue = planned.slice().sort((a, b) => a.activateAtMeters - b.activateAtMeters);
  const active: ActiveEffect[] = [];
  let targetSpeedModifier = 0;
  let accelModifier = 0;
  let currentSpeedModifier = 0;
  let oneFrameAccel = 0;

  const effectiveDurationSeconds: Record<number, number> = {};
  const wastedDurationSeconds: Record<number, number> = {};
  const activationPositions: Record<number, number> = {};
  for (const p of planned) {
    effectiveDurationSeconds[p.skillId] = 0;
    wastedDurationSeconds[p.skillId] = 0;
  }

  const trace: { t: number; pos: number }[] = options.recordTrace ? [{ t: 0, pos: 0 }] : [];

  const maxFrames = Math.ceil(SIMULATION.maxRaceSeconds / dt);
  let finished = false;
  let finishTime = SIMULATION.maxRaceSeconds;
  let finishSpeed = 0;

  for (let frame = 0; frame < maxFrames; frame += 1) {
    /* ---- gate ---- */
    if (time < startDelay) {
      time += dt;
      if (options.recordTrace) trace.push({ t: time, pos: position });
      continue;
    }

    const uphill = uphillAt(position);
    const onUphill = uphill !== null;
    const minSpeed = minSpeedOf();

    /* ---- half-step velocity, then integrate position ---- */
    let accel: number;
    if (hp <= 0) {
      accel = SIMULATION.exhaustedDeceleration;
    } else {
      accel = accelOf(phase, onUphill) + accelModifier + (startDash ? SIMULATION.startDashAccelBonus : 0);
    }

    // Target speed for this frame.
    let target: number;
    if (hp <= 0) {
      target = minSpeed;
    } else if (isLastSpurt && spurt) {
      target = spurt.speed;
    } else {
      target = cruiseSpeed(phase) * (paceDownActive ? paceDownCoefficient(phase) : 1);
    }
    target += sectionModifier[Math.min(sectionCount, Math.floor(position / sectionLength))];
    target += targetSpeedModifier;
    if (onUphill) {
      target -= (uphill.gradePercent * SIMULATION.uphillSpeedPenaltyCoefficient) / powerStat;
      target = Math.max(target, minSpeed);
    }

    // Decelerate instead of accelerating when already above target.
    if (hp > 0 && currentSpeed > target) {
      accel = paceDownActive
        ? SIMULATION.paceDownDeceleration
        : SIMULATION.decelerationByPhase[Math.min(phase, 2)];
    }

    const speedCap = startDash
      ? Math.min(target, SIMULATION.startDashSpeedThreshold * baseSpeed)
      : currentSpeed + oneFrameAccel > target
        ? Number.POSITIVE_INFINITY
        : target;

    const halfV = Math.min(currentSpeed + 0.5 * dt * accel, speedCap);
    // Current-speed skills are a velocity offset applied to the displacement, not
    // an instantaneous change to the runner's own speed.
    const displacement = halfV + currentSpeedModifier;

    const nextPosition = position + displacement * dt;

    /* ---- stamina ---- */
    hp -= hpPerSecond(currentSpeed, phase, paceDownActive) * dt;
    minHpFraction = Math.min(minHpFraction, Math.max(0, hp) / maxHp);
    if (hp <= 0) ranOutOfStamina = true;

    for (const e of active) {
      effectiveDurationSeconds[e.skillId] = (effectiveDurationSeconds[e.skillId] ?? 0) + dt;
    }

    /* ---- finish ---- */
    if (nextPosition >= distance) {
      const overshoot = nextPosition - distance;
      const partial = displacement > 0 ? overshoot / displacement : 0;
      finishTime = time + dt - partial;
      finished = true;
      finishSpeed = displacement;
      for (const e of active) {
        if (e.endsAt > finishTime) {
          wastedDurationSeconds[e.skillId] = (wastedDurationSeconds[e.skillId] ?? 0) + (e.endsAt - finishTime);
        }
      }
      // Anything still queued never fired: its whole duration is wasted.
      for (const pending of queue) {
        wastedDurationSeconds[pending.skillId] =
          (wastedDurationSeconds[pending.skillId] ?? 0) +
          (pending.durationSeconds === Infinity ? 0 : pending.durationSeconds);
      }
      if (options.recordTrace) trace.push({ t: finishTime, pos: distance });
      break;
    }

    position = nextPosition;
    time += dt;
    if (options.recordTrace) trace.push({ t: time, pos: position });

    /* ---- phase ---- */
    while (phase < 3 && position >= phaseStart(distance, phase + 1)) phase += 1;

    /* ---- relative race state ---- */
    if (hasOpponents) {
      const opponentPositions = opponentsAtFrame(frame + 1, time);
      relative = updateRelativeState({
        playerPosition: position,
        previousPlayerPosition,
        opponentPositions,
        previousOpponentPositions,
        previousRank: relative.rank,
        history: eventHistory,
        phase,
        pastFinalCorner: course.finalCorner ? position >= course.finalCorner.start : false,
        dt,
      });
      // Copy: the frame-indexed lookup reuses one scratch array.
      for (let i = 0; i < opponentPositions.length; i += 1) previousOpponentPositions[i] = opponentPositions[i];
      previousPlayerPosition = position;
    }

    /* ---- position keeping ---- */
    if (paceDownEligible && position < positionKeepEnd) {
      if (hasOpponents && RACE_FIELD.opponentDrivenPositionKeep) {
        // Gap-driven pace-down: back off only while sitting too close to the runner
        // in front, and stop as soon as a speed skill is carrying us.
        const gap = relative.distanceToRunnerAhead;
        const tooClose = gap !== undefined && gap < RACE_FIELD.positionKeepMinGapMeters;
        const boosted = targetSpeedModifier > 0 || currentSpeedModifier > 0;
        paceDownActive = tooClose && !boosted;
      } else {
        // Phase-based model. Measured against the reference this tracks umalator
        // more closely than the gap-driven rule, so it stays the default; see
        // RACE_FIELD.opponentDrivenPositionKeep.
        paceDownActive = phase <= 1;
      }
    } else {
      paceDownActive = false;
    }

    /* ---- expire effects ---- */
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].endsAt <= time) {
        const e = active[i];
        active.splice(i, 1);
        targetSpeedModifier -= e.targetSpeed;
        accelModifier -= e.acceleration;
        currentSpeedModifier -= e.currentSpeed;
        if (e.naturalDeceleration) oneFrameAccel += e.currentSpeed;
      }
    }

    /* ---- activate scheduled effects ---- */
    const conditionContext = (): ConditionContext => ({
      position,
      timeSeconds: time,
      phase,
      hpFraction: Math.max(0, hp) / maxHp,
      isLastSpurt,
      relative,
      events: eventHistory,
    });

    for (let qi = 0; qi < queue.length; qi += 1) {
      const candidate = queue[qi];
      const trigger = candidate.trigger;
      let ready: boolean;
      if (trigger) {
        if (position >= trigger.windowEnd) {
          // The eligibility window closed without the event happening.
          queue.splice(qi, 1);
          qi -= 1;
          continue;
        }
        ready = position >= trigger.windowStart && trigger.predicate(conditionContext());
      } else {
        ready = candidate.activateAtMeters <= position;
      }
      if (!ready) continue;

      const item = candidate;
      queue.splice(qi, 1);
      qi -= 1;

      if (!options.forceSkillActivation && procRate < 1 && procRng.next() > procRate) {
        wastedDurationSeconds[item.skillId] =
          (wastedDurationSeconds[item.skillId] ?? 0) +
          (item.durationSeconds === Infinity ? 0 : item.durationSeconds);
        continue;
      }
      activationPositions[item.skillId] = position;

      const duration = item.durationSeconds;
      const acc: ActiveEffect = {
        skillId: item.skillId,
        endsAt: duration === Infinity ? Number.POSITIVE_INFINITY : time + duration,
        targetSpeed: 0,
        acceleration: 0,
        currentSpeed: 0,
        naturalDeceleration: false,
      };

      for (const eff of item.effects) {
        switch (eff.kind) {
          case 'target_speed':
            acc.targetSpeed += scale(eff.rawValue);
            break;
          case 'acceleration':
            acc.acceleration += scale(eff.rawValue);
            break;
          case 'current_speed':
            acc.currentSpeed += scale(eff.rawValue);
            // Effect type 22 restores the velocity gradually when it ends.
            if (eff.rawType === 22) acc.naturalDeceleration = true;
            break;
          case 'stamina_recovery': {
            const fraction = Math.max(
              eff.rawValue / SIMULATION.recoveryValueScale,
              -SIMULATION.staminaDrainClampFraction,
            );
            hp = Math.min(maxHp, hp + maxHp * fraction);
            break;
          }
          case 'speed_stat':
            speedStat = Math.max(1, speedStat + scale(eff.rawValue));
            break;
          case 'power_stat':
            powerStat = Math.max(1, powerStat + scale(eff.rawValue));
            break;
          case 'guts_stat':
            gutsStat = Math.max(1, gutsStat + scale(eff.rawValue));
            break;
          case 'wit_stat':
            witStat = Math.max(1, witStat + scale(eff.rawValue));
            break;
          case 'stamina_stat': {
            // Raising Stamina raises the pool; the runner keeps the HP it has spent.
            const spent = maxHp - hp;
            staminaStat = Math.max(1, staminaStat + scale(eff.rawValue));
            maxHp = distance + SIMULATION.hpStaminaCoefficient * STRATEGY_HP[runner.runningStyle] * staminaStat;
            hp = Math.max(0, maxHp - spent);
            break;
          }
          case 'all_stats':
            speedStat = Math.max(1, speedStat + scale(eff.rawValue));
            powerStat = Math.max(1, powerStat + scale(eff.rawValue));
            gutsStat = Math.max(1, gutsStat + scale(eff.rawValue));
            witStat = Math.max(1, witStat + scale(eff.rawValue));
            break;
          default:
            // Field-of-view, lane movement, rush chance, debuff immunity and the
            // rest have no representation without opponents; the ranking layer
            // reports them as "not modelled".
            break;
        }
      }

      targetSpeedModifier += acc.targetSpeed;
      accelModifier += acc.acceleration;
      currentSpeedModifier += acc.currentSpeed;
      if (acc.endsAt !== Number.POSITIVE_INFINITY || acc.targetSpeed || acc.acceleration || acc.currentSpeed) {
        active.push(acc);
      }
    }

    /* ---- last spurt ---- */
    if (!isLastSpurt && phase >= 2) {
      if (!spurt) {
        spurt = planLastSpurt({
          hp,
          position,
          distance,
          maxSpeed: spurtTopSpeed(),
          cruiseSpeed: cruiseSpeed(2),
          hpPerSecond: (v) => hpPerSecond(v, 2, false),
          rng: spurtRng,
          wit: witStat,
        });
      }
      if (spurt.transition === -1 || position >= spurt.transition) isLastSpurt = true;
    }

    /* ---- close the velocity step ---- */
    currentSpeed = Math.min(halfV + 0.5 * dt * accel + oneFrameAccel, speedCap);
    oneFrameAccel = 0;
    if (!startDash && currentSpeed < minSpeed && hp > 0) {
      currentSpeed = minSpeed;
    } else if (startDash && currentSpeed >= SIMULATION.startDashSpeedThreshold * baseSpeed) {
      startDash = false;
    }
  }

  return {
    finishTimeSeconds: finishTime,
    finished,
    finishSpeed,
    minHpFraction,
    ranOutOfStamina,
    hpRemainingFraction: Math.max(0, hp) / maxHp,
    spurtStartMeters: spurt ? (spurt.transition === -1 ? phaseStart(distance, 2) : spurt.transition) : null,
    spurtSpeed: spurt ? spurt.speed : null,
    fullSpurt: spurt ? spurt.transition === -1 : false,
    startDelaySeconds: startDelay,
    seed: options.seed,
    effectiveDurationSeconds,
    wastedDurationSeconds,
    activationPositions,
    trace,
  };
}

function paceDownCoefficient(phase: number): number {
  return phase === 1
    ? SIMULATION.paceDownSpeedCoefficientMiddle
    : SIMULATION.paceDownSpeedCoefficientOther;
}

/**
 * Position of a recorded run at an arbitrary elapsed time, linearly interpolated
 * between frames. Used by the horse-length comparison, which needs both runs
 * evaluated at the same instant.
 */
export function positionAtTime(result: SimulationResult, t: number): number {
  const trace = result.trace;
  if (!trace || trace.length === 0) return 0;
  if (t <= trace[0].t) return trace[0].pos;
  const last = trace[trace.length - 1];
  if (t >= last.t) {
    // Extrapolate past the finish at the final speed so an early finisher is not
    // frozen on the line while the other runner is still moving.
    return last.pos + (t - last.t) * result.finishSpeed;
  }
  let lo = 0;
  let hi = trace.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = trace[lo];
  const b = trace[hi];
  const span = b.t - a.t;
  if (span <= 0) return a.pos;
  return a.pos + ((t - a.t) / span) * (b.pos - a.pos);
}
