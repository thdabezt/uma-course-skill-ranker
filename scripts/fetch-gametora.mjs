#!/usr/bin/env node
/**
 * Downloads the public, static game-data payloads that gametora.com serves to its
 * own front-end, and stores them verbatim under `data/raw/`.
 *
 * Why this source: GameTora publishes a content-hash manifest at
 * `/data/manifests/umamusume.json` and serves plain JSON documents at
 * `/data/umamusume/<key>.<hash>.json`. Those URLs are public, un-authenticated,
 * cacheable and are NOT disallowed by https://gametora.com/robots.txt. We read the
 * manifest once and then pull a small fixed list of documents (10 requests total,
 * sequential, with a polite delay). This is deliberately not a crawler: no link
 * following, no pagination, no HTML parsing, no per-entity requests.
 *
 * Total request count per refresh: 1 manifest + 9 documents.
 *
 * Nothing here is transformed. Normalization happens in `scripts/build-data.mjs`,
 * so raw upstream payloads and application data stay separate.
 *
 * Usage:  node scripts/fetch-gametora.mjs [--force]
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');

const ORIGIN = 'https://gametora.com';
const MANIFEST_URL = `${ORIGIN}/data/manifests/umamusume.json`;
const USER_AGENT =
  'uma-course-skill-ranker/0.1 (personal, non-commercial analysis tool; low volume: 10 requests per refresh)';

/** Manifest keys we consume, mapped to the local file name we store them under. */
const DOCUMENTS = [
  { key: 'skills', file: 'skills.json' },
  { key: 'characters', file: 'characters.json' },
  { key: 'character-cards', file: 'character-cards.json' },
  { key: 'racetracks', file: 'racetracks.json' },
  { key: 'racetracks_extended', file: 'racetracks-extended.json' },
  { key: 'races', file: 'races.json' },
  { key: 'en/events/champions-meeting', file: 'champions-meeting-global.json' },
  { key: 'events/champions-meeting', file: 'champions-meeting-jp.json' },
  { key: 'static/skill_conditions', file: 'skill-conditions.json' },
];

const POLITE_DELAY_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const force = process.argv.includes('--force');
  await mkdir(RAW_DIR, { recursive: true });

  const metaPath = path.join(RAW_DIR, '_meta.json');
  /** @type {any} */
  let previous = null;
  if (existsSync(metaPath)) {
    try {
      previous = JSON.parse(await readFile(metaPath, 'utf8'));
    } catch {
      previous = null;
    }
  }

  console.log(`> manifest ${MANIFEST_URL}`);
  const manifest = await getJson(MANIFEST_URL);

  const documents = [];
  let downloaded = 0;

  for (const doc of DOCUMENTS) {
    const hash = manifest[doc.key];
    if (typeof hash !== 'string') {
      throw new Error(
        `Manifest has no entry for "${doc.key}". Upstream layout changed - refusing to guess a URL.`,
      );
    }
    const url = `${ORIGIN}/data/umamusume/${doc.key}.${hash}.json`;
    const target = path.join(RAW_DIR, doc.file);
    const cachedHash = previous?.documents?.find((d) => d.key === doc.key)?.contentHash;

    if (!force && cachedHash === hash && existsSync(target)) {
      console.log(`  = ${doc.key} (cached, hash ${hash})`);
      documents.push({ key: doc.key, file: doc.file, contentHash: hash, sourceUrl: url });
      continue;
    }

    await sleep(POLITE_DELAY_MS);
    const payload = await getJson(url);
    await writeFile(target, JSON.stringify(payload), 'utf8');
    downloaded += 1;
    const count = Array.isArray(payload) ? payload.length : Object.keys(payload).length;
    console.log(`  + ${doc.key} -> data/raw/${doc.file} (${count} entries)`);
    documents.push({ key: doc.key, file: doc.file, contentHash: hash, sourceUrl: url });
  }

  const meta = {
    source: 'GameTora (gametora.com)',
    sourceHomepage: `${ORIGIN}/umamusume`,
    manifestUrl: MANIFEST_URL,
    fetchedAt: new Date().toISOString(),
    documents,
    note:
      'Public static JSON used by gametora.com itself. Re-run `npm run data:refresh` to update. ' +
      'Game data and names are the property of Cygames / Umamusume Pretty Derby; this project ' +
      'only derives analysis from publicly published values.',
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  console.log(`\ndone: ${downloaded} downloaded, ${DOCUMENTS.length - downloaded} cached`);
  console.log(`meta -> data/raw/_meta.json (fetchedAt ${meta.fetchedAt})`);
}

main().catch((err) => {
  console.error(`\nfetch failed: ${err.message}`);
  process.exit(1);
});
