/**
 * Provenance record for everything this engine models.
 *
 * The application targets the **Global (EN) server**. Japanese-version values are
 * never substituted for missing Global values; where Global and JP genuinely
 * differ, the Global behaviour is implemented and the difference is listed in
 * `GLOBAL_JP_DIFFERENCES` below.
 */

export interface GlobalDataVersion {
  region: 'global';
  gameVersion?: string;
  /** When the upstream game data snapshot was fetched. */
  dataUpdatedAt: string;
  /** GameTora payload timestamp (character / skill / course / availability data). */
  gameToraUpdatedAt?: string;
  /** Exact commit of the mechanical reference that was inspected. */
  umalatorReferenceCommit?: string;
  umalatorReferenceDate?: string;
  umalatorSubmoduleCommit?: string;
  /** When a human last verified the above. */
  verifiedAt: string;
}

export const GLOBAL_DATA_VERSION: GlobalDataVersion = {
  region: 'global',
  dataUpdatedAt: '2026-07-30',
  gameToraUpdatedAt: '2026-07-30',
  umalatorReferenceCommit: 'aee0820303e3f5cfaac2522c074ea82e443cfc32',
  umalatorReferenceDate: '2026-07-25',
  umalatorSubmoduleCommit: '6ba5ca07fcfdca96d9fc03d58a50a751bcebddd2',
  verifiedAt: '2026-07-31',
};

/**
 * Mechanical reference.
 *
 * `alpha123/uma-tools` (and its `uma-skill-tools` submodule) is licensed **GPL-3.0**.
 * This project is not GPL-licensed, so **no code was copied, translated line by line,
 * or structurally reproduced**. The repository was read to determine the *mechanics*
 * - the equations, their inputs and their outputs - which are facts about the game,
 * not expression. Everything here is an independent implementation, and the
 * simulator's published output is used only as a test oracle.
 */
export const MECHANICAL_REFERENCE = {
  name: 'alpha123/uma-tools (umalator-global)',
  url: 'https://github.com/alpha123/uma-tools',
  license: 'GPL-3.0',
  usage: 'behaviour and equations studied; independently reimplemented; output used as a test oracle',
  liveTool: 'https://alpha123.github.io/uma-tools/umalator-global/',
} as const;

/**
 * Mechanics that differ between the Global build and the Japanese build of the
 * reference simulator, as gated by its `CC_GLOBAL` compile-time flag. The Global
 * behaviour is what this engine implements.
 */
export const GLOBAL_JP_DIFFERENCES: { mechanic: string; global: string; japan: string }[] = [
  {
    mechanic: 'Last-spurt top speed',
    global: 'No Guts contribution.',
    japan: 'Adds (450 * guts) ^ 0.597 * 0.0001 to the last-spurt speed.',
  },
  {
    mechanic: 'Recovery skill during the final leg',
    global: 'Does not re-plan the last spurt when a recovery skill fires after the final leg has begun.',
    japan: 'Re-plans the last spurt, so a recovery skill can upgrade an already-reduced spurt.',
  },
  {
    mechanic: 'Stamina Showdown (スタミナ勝負) inherited effect',
    global: 'Not present.',
    japan: 'Applied by the reference tool as an approximate stamina modifier.',
  },
  {
    mechanic: 'Seasons',
    global: 'Four seasons.',
    japan: 'Adds a fifth (late spring / cherry blossom) season.',
  },
  {
    mechanic: 'Skill evolution',
    global: 'No evolution skill has shipped; character scores contain the unique skill only.',
    japan: 'Evolution skills are live and contribute to a character score.',
  },
];

/**
 * Known caveats about the reference itself, so its output is not treated as ground
 * truth where it is explicitly incomplete.
 */
export const REFERENCE_LIMITATIONS: string[] = [
  'Position keeping is capped at 5 course sections rather than the 10 the game uses.',
  'Downhill acceleration mode is not implemented in its stamina policy.',
  'Lane movement, blocking and physical interference are not simulated.',
  'Its own course data is a Global snapshot that can lag a live Global balance patch.',
];
