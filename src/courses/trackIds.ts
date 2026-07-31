/**
 * Canonical Global racecourse ids.
 *
 * Single source of truth. Numeric track ids must never be written literally
 * anywhere else - import from here so a mapping can only be wrong in one place.
 * Values verified against GameTora's `racetracks` payload and the Global course
 * data shipped with the mechanical reference.
 */

export const GLOBAL_TRACK_IDS = {
  SAPPORO: 10001,
  HAKODATE: 10002,
  NIIGATA: 10003,
  FUKUSHIMA: 10004,
  NAKAYAMA: 10005,
  TOKYO: 10006,
  CHUKYO: 10007,
  KYOTO: 10008,
  HANSHIN: 10009,
  KOKURA: 10010,
  OI: 10101,
  KAWASAKI: 10103,
  FUNABASHI: 10104,
  MORIOKA: 10105,
  /**
   * Overseas racecourse that IS live on Global (the Arc). Not part of the domestic
   * 14, but present in the Global course data, so it belongs in the canonical map.
   */
  LONGCHAMP: 10201,
} as const;

export type GlobalTrackName = keyof typeof GLOBAL_TRACK_IDS;
export type GlobalTrackId = (typeof GLOBAL_TRACK_IDS)[GlobalTrackName];

export const TRACK_NAME_BY_ID: Record<number, string> = {
  [GLOBAL_TRACK_IDS.SAPPORO]: 'Sapporo',
  [GLOBAL_TRACK_IDS.HAKODATE]: 'Hakodate',
  [GLOBAL_TRACK_IDS.NIIGATA]: 'Niigata',
  [GLOBAL_TRACK_IDS.FUKUSHIMA]: 'Fukushima',
  [GLOBAL_TRACK_IDS.NAKAYAMA]: 'Nakayama',
  [GLOBAL_TRACK_IDS.TOKYO]: 'Tokyo',
  [GLOBAL_TRACK_IDS.CHUKYO]: 'Chukyo',
  [GLOBAL_TRACK_IDS.KYOTO]: 'Kyoto',
  [GLOBAL_TRACK_IDS.HANSHIN]: 'Hanshin',
  [GLOBAL_TRACK_IDS.KOKURA]: 'Kokura',
  [GLOBAL_TRACK_IDS.OI]: 'Ooi',
  [GLOBAL_TRACK_IDS.KAWASAKI]: 'Kawasaki',
  [GLOBAL_TRACK_IDS.FUNABASHI]: 'Funabashi',
  [GLOBAL_TRACK_IDS.MORIOKA]: 'Morioka',
  [GLOBAL_TRACK_IDS.LONGCHAMP]: 'Longchamp',
};

/** NAR local dirt racecourses; `is_dirtgrade` exchange races run on these. */
export const LOCAL_DIRT_TRACK_IDS: number[] = [
  GLOBAL_TRACK_IDS.OI,
  GLOBAL_TRACK_IDS.KAWASAKI,
  GLOBAL_TRACK_IDS.FUNABASHI,
  GLOBAL_TRACK_IDS.MORIOKA,
];

/** Racecourses the game classifies as tight-cornered. */
export const TIGHT_TRACK_IDS: number[] = [
  GLOBAL_TRACK_IDS.SAPPORO,
  GLOBAL_TRACK_IDS.HAKODATE,
  GLOBAL_TRACK_IDS.FUKUSHIMA,
  GLOBAL_TRACK_IDS.NAKAYAMA,
  GLOBAL_TRACK_IDS.KOKURA,
  ...LOCAL_DIRT_TRACK_IDS,
];

export const isGlobalTrackId = (id: number): boolean => id in TRACK_NAME_BY_ID;
