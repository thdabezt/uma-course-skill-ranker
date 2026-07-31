/**
 * Values recorded manually from umalator-global's Skill table on 2026-07-30
 * (https://alpha123.github.io/uma-tools/umalator-global/), configured with the
 * same reference runner as `DEFAULT_RUNNER`: 1100 / 900 / 900 / 500 / 700,
 * Pace Chaser, Firm ground, A aptitudes, no opponents added.
 *
 * Calibration reference only. Nothing here feeds the application, and no local
 * value is ever tuned to match these numbers.
 */

export interface UtoolsEntry {
  mean: number;
  min: number;
  max: number;
}

export interface UtoolsRace {
  race: string;
  trackName: string;
  surface: 'turf' | 'dirt';
  distance: number;
  /** Skill kind, for the report. */
  kinds: Record<string, string>;
  /** Disambiguates a unique skill from its inheritable copy where the name is shared. */
  rarities?: Record<string, string>;
  utools: Record<string, UtoolsEntry>;
}

export const RACES: UtoolsRace[] = [
  {
    race: 'Takamatsunomiya Kinen',
    trackName: 'Chukyo',
    surface: 'turf',
    distance: 1200,
    kinds: {
      'Neck and Neck': 'speed (gold)',
      Highlander: 'acceleration (white)',
      'Rushing Gale!': 'random activation (gold)',
      'Speed Star': 'speed (gold)',
      'Firm Conditions ◎': 'passive',
      'Firm Conditions ○': 'passive',
      'Left-Handed ◎': 'passive',
      'Certain Victory': 'inherited unique',
    },
    // umalator listed Certain Victory at 200 SP, i.e. the inheritable copy, not the
    // character's own unique skill.
    rarities: { 'Certain Victory': 'inherited_unique' },
    utools: {
      'Neck and Neck': { mean: 2.6, min: 1.75, max: 3.44 },
      Highlander: { mean: 1.02, min: 0.4, max: 1.67 },
      'Rushing Gale!': { mean: 0.81, min: 0.02, max: 4.4 },
      'Speed Star': { mean: 0.53, min: 0.1, max: 1.96 },
      'Firm Conditions ◎': { mean: 0.38, min: 0.3, max: 0.79 },
      'Firm Conditions ○': { mean: 0.26, min: 0.2, max: 0.66 },
      'Left-Handed ◎': { mean: 0.19, min: 0.16, max: 0.2 },
      'Certain Victory': { mean: 1.01, min: 0.0, max: 1.37 },
    },
  },
  {
    race: 'Yasuda Kinen',
    trackName: 'Tokyo',
    surface: 'turf',
    distance: 1600,
    kinds: {
      'Neck and Neck': 'speed (gold)',
      Acceleration: 'acceleration (white)',
      'Speed Star': 'speed (gold)',
      'Corner Connoisseur': 'random activation (gold)',
      'Firm Conditions ◎': 'passive',
      'Firm Conditions ○': 'passive',
      'Left-Handed ◎': 'passive',
      'Left-Handed ○': 'passive',
    },
    utools: {
      'Neck and Neck': { mean: 3.39, min: 2.07, max: 4.77 },
      Acceleration: { mean: 1.03, min: 0.0, max: 3.72 },
      'Speed Star': { mean: 0.83, min: 0.15, max: 2.31 },
      'Corner Connoisseur': { mean: 0.52, min: 0.0, max: 5.68 },
      'Firm Conditions ◎': { mean: 0.49, min: 0.43, max: 0.65 },
      'Firm Conditions ○': { mean: 0.34, min: 0.28, max: 0.49 },
      'Left-Handed ◎': { mean: 0.29, min: 0.29, max: 0.3 },
      'Left-Handed ○': { mean: 0.2, min: 0.19, max: 0.2 },
    },
  },
  {
    race: 'Japan Cup',
    trackName: 'Tokyo',
    surface: 'turf',
    distance: 2400,
    kinds: {
      'Neck and Neck': 'speed (gold)',
      'Refraction Arc': 'speed (gold)',
      'Corner Connoisseur': 'random activation (gold)',
      'Firm Conditions ◎': 'passive',
      'Firm Conditions ○': 'passive',
      'Left-Handed ○': 'passive',
      'Tokyo Racecourse ◎': 'passive',
    },
    utools: {
      'Neck and Neck': { mean: 1.68, min: 0.09, max: 4.19 },
      'Refraction Arc': { mean: 1.06, min: 0.0, max: 2.44 },
      'Corner Connoisseur': { mean: 0.6, min: -0.01, max: 4.49 },
      'Firm Conditions ◎': { mean: 0.46, min: 0.2, max: 0.67 },
      'Firm Conditions ○': { mean: 0.31, min: 0.19, max: 0.52 },
      'Left-Handed ○': { mean: 0.55, min: 0.51, max: 0.56 },
      'Tokyo Racecourse ◎': { mean: 0.0, min: 0.0, max: 0.04 },
    },
  },
  {
    race: 'Arima Kinen',
    trackName: 'Nakayama',
    surface: 'turf',
    distance: 2500,
    kinds: {
      'Neck and Neck': 'speed (gold)',
      'Beeline Burst': 'speed (gold)',
      Unstoppable: 'speed (gold)',
      'Hot Pursuit': 'speed (gold)',
      'Right-Handed ◎': 'passive',
      'Right-Handed ○': 'passive',
      'Firm Conditions ◎': 'passive',
      'Firm Conditions ○': 'passive',
    },
    utools: {
      'Neck and Neck': { mean: 1.97, min: 0.14, max: 4.39 },
      'Beeline Burst': { mean: 1.18, min: 0.0, max: 2.6 },
      Unstoppable: { mean: 0.99, min: 0.81, max: 1.8 },
      'Hot Pursuit': { mean: 0.86, min: 0.0, max: 2.32 },
      'Right-Handed ◎': { mean: 0.76, min: -0.21, max: 1.62 },
      'Right-Handed ○': { mean: 0.5, min: -0.46, max: 0.57 },
      'Firm Conditions ◎': { mean: 0.58, min: 0.46, max: 0.72 },
      'Firm Conditions ○': { mean: 0.39, min: 0.3, max: 0.53 },
    },
  },
];
