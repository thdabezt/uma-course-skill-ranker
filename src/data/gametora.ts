/**
 * SINGLE SOURCE OF TRUTH for outbound GameTora links.
 *
 * Imported by both the application and `scripts/build-data.mjs`
 * (Node type-stripping), so a URL shown in the UI is always the same one the data
 * pipeline validated.
 *
 * What GameTora actually publishes (verified against the live site):
 *   - character cards  https://gametora.com/umamusume/characters/<url_name>   -> exists
 *   - support cards    https://gametora.com/umamusume/supports/<url_name>     -> exists
 *   - skills           NO per-skill page. The skill list at /umamusume/skills
 *                      renders no anchors and honours no deep-link parameter.
 *
 * Because of that, skills only get a link when there is a canonical GameTora page
 * that genuinely documents them: a unique skill links to the page of the character
 * card that owns it. Every other skill is left without a URL and is rendered as
 * plain, non-interactive text. URLs are never assembled from English display
 * names.
 */

export const GAMETORA_ORIGIN = 'https://gametora.com';

export type GameToraLinkKind = 'character' | 'skill';

export interface GameToraLink {
  url: string;
  kind: GameToraLinkKind;
  /** Shown as the link's accessible description. */
  label: string;
}

/** `url_name` values look like `100101-special-week`. */
const URL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidUrlName(urlName: unknown): urlName is string {
  return typeof urlName === 'string' && urlName.length > 0 && URL_NAME_RE.test(urlName);
}

/** Canonical page for a playable character card. Returns null if the id is unusable. */
export function characterUrl(urlName: unknown): string | null {
  if (!isValidUrlName(urlName)) return null;
  return `${GAMETORA_ORIGIN}/umamusume/characters/${urlName}`;
}

/**
 * Final safety net before a URL is stored or rendered: it has to be an absolute
 * https URL on gametora.com under the /umamusume/ tree.
 */
export function isValidGameToraUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'gametora.com' &&
    parsed.pathname.startsWith('/umamusume/') &&
    parsed.pathname.length > '/umamusume/'.length
  );
}
