/**
 * Horse-length ("bashin") conversion.
 *
 * HOW THE REFERENCE DOES IT
 * -------------------------
 * The Global reference simulator does **not** convert a time saving into a
 * distance. It compares two runners directly:
 *
 *   1. Run the faster runner until it crosses the finish line, noting its total
 *      elapsed race time T.
 *   2. Step the slower runner until its elapsed time also reaches T.
 *   3. The gap is the difference in the two runners' positions at that moment.
 *   4. bashin = gap_in_metres / 2.5
 *
 * So the 2.5 m per length figure IS confirmed by the Global implementation, but
 * the *gap* it is applied to is a position difference measured at equal elapsed
 * time - not `timeSaved * finishSpeed`. Those two agree only when the trailing
 * runner is travelling at exactly the leader's finishing speed, which is usually
 * false (the trailing runner is often still accelerating into, or decelerating
 * out of, its last spurt). Measuring the real position gap removes that error.
 *
 * Reference: alpha123/uma-tools, umalator comparison routine, commit
 * aee0820303e3f5cfaac2522c074ea82e443cfc32 (GPL-3.0 - behaviour studied only,
 * see src/simulation/globalVersion.ts).
 */

/** Metres per horse length, as used by the Global reference implementation. */
export const METRES_PER_HORSE_LENGTH = 2.5;

export type HorseLengthMethod = 'position-gap-at-equal-time' | 'time-saved-times-finish-speed';

/**
 * How a length is computed. `position-gap-at-equal-time` reproduces the Global
 * reference; the other method is kept only so the difference can be measured.
 */
export const HORSE_LENGTH_METHOD: HorseLengthMethod = 'position-gap-at-equal-time';

export const metresToHorseLengths = (metres: number): number => metres / METRES_PER_HORSE_LENGTH;

export const horseLengthsToMetres = (lengths: number): number => lengths * METRES_PER_HORSE_LENGTH;

export interface FinishComparison {
  /** Elapsed time at which the leader crossed the line. */
  leaderFinishTimeSeconds: number;
  /** Position of the trailing runner at that same elapsed time. */
  trailingPositionMeters: number;
  /** Course distance, i.e. the leader's position. */
  courseDistance: number;
  metresGained: number;
  horseLengths: number;
  /** True when the "with skill" run was the slower of the two. */
  skillRunWasSlower: boolean;
}

/**
 * Compares a baseline run against a with-skill run.
 *
 * `positionAtTime` must return how far a run had travelled at a given elapsed
 * time. Whichever run finishes first is treated as the leader, and the sign is
 * flipped when the skill made the runner slower, so a harmful skill scores
 * negative.
 */
export function compareFinish(args: {
  baselineFinishTime: number;
  baselinePositionAtTime: (t: number) => number;
  skillFinishTime: number;
  skillPositionAtTime: (t: number) => number;
  courseDistance: number;
}): FinishComparison {
  const { baselineFinishTime, baselinePositionAtTime, skillFinishTime, skillPositionAtTime, courseDistance } =
    args;

  const skillIsFaster = skillFinishTime <= baselineFinishTime;
  const leaderFinishTime = skillIsFaster ? skillFinishTime : baselineFinishTime;
  const trailingPosition = skillIsFaster
    ? baselinePositionAtTime(leaderFinishTime)
    : skillPositionAtTime(leaderFinishTime);

  const gap = courseDistance - trailingPosition;
  const signedGap = skillIsFaster ? gap : -gap;

  return {
    leaderFinishTimeSeconds: leaderFinishTime,
    trailingPositionMeters: trailingPosition,
    courseDistance,
    metresGained: signedGap,
    horseLengths: metresToHorseLengths(signedGap),
    skillRunWasSlower: !skillIsFaster,
  };
}
