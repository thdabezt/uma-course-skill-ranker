# Uma Musume Course Skill Ranker (Global)

Ranks **skills** and **characters** for a selected racecourse in *Uma Musume: Pretty Derby* — **Global (EN) version only** — using an independent deterministic race simulation.

For each skill it answers: *can it fire here, how often, and how many horse lengths is it actually worth on this course?*

**Live site: https://thdabezt.github.io/uma-course-skill-ranker/**

---

## Quick start

```bash
npm install
```

```bash
npm run data:refresh
```

```bash
npm run dev
```

Then open <http://localhost:3000>.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run data:fetch` | Download the upstream payloads into `data/raw/` (content-hash cached) |
| `npm run data:build` | Normalize `data/raw/` into `data/normalized/` (Global-only, validated, audited) |
| `npm run data:audit` | Structural audit of `data/normalized/courses.json` |
| `npm run data:refresh` | Both of the above |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |

`data/normalized/` is committed, so the app runs without a network round-trip. `data/raw/` is gitignored and reproducible via `npm run data:fetch`.

You do not have to run `data:refresh` by hand to keep the deployed site current — a
scheduled workflow does it daily. See [Automatic data refresh](#automatic-data-refresh).

---

## Layout

```
data/raw/            verbatim upstream payloads + _meta.json (source URLs, fetch timestamp)
data/normalized/     application data model, Global-only + a separate excluded-non-global.json
scripts/             fetch-gametora.mjs, build-data.mjs
src/simulation/      config.ts (EVERY assumption), simulator.ts, types.ts
src/courses/         distanceCategory.ts (single source of truth), course section detection
src/skills/          condition parser, activation analysis, effect handling
src/ranking/         skill evaluation, skill ranking, character ranking
src/components/      React UI
tests/               Vitest suites
.github/workflows/   ci.yml (typecheck, lint, test), deploy.yml (Pages),
                     refresh-data.yml (scheduled upstream data refresh)
```

---

## Deployment

The app is entirely client-side, so it ships as a Next.js static export to
GitHub Pages. Every push to `main` runs `.github/workflows/deploy.yml`.

Project sites live under `/<repo>`, so the build needs a matching prefix — set
by the workflow, and empty in `next dev`:

```bash
NEXT_PUBLIC_BASE_PATH=/uma-course-skill-ranker npm run build
```

### Automatic data refresh

`.github/workflows/refresh-data.yml` runs daily (and on demand from the Actions tab)
so newly announced Champions Meeting cups, skills and characters reach the live site
without anyone running a command:

1. `npm run data:refresh` pulls the current GameTora payloads and re-normalizes them.
   The fetcher throws if a manifest key it expects has disappeared, so an upstream
   layout change fails the run instead of shipping partial data.
2. `data:audit`, `typecheck`, `test` and a full `next build` all have to pass. Bad
   upstream data cannot reach `main`.
3. Only then does it commit `data/normalized/` — and only if something actually
   changed. `meta.json`'s timestamps move on every run, so they alone do not count as
   a change; that stamp is refreshed on its own once a week to keep the site's "last
   fetched" line honest.
4. It then dispatches `deploy.yml`. That last step is explicit because a push made
   with `GITHUB_TOKEN` deliberately does not trigger other workflows.

Most days it finds nothing and exits without committing.

---

## Data source

Skill, character, racecourse and race data is derived from the **public static JSON that
[GameTora](https://gametora.com/umamusume) serves to its own front-end**:

* content-hash manifest: `https://gametora.com/data/manifests/umamusume.json`
* documents: `https://gametora.com/data/umamusume/<key>.<hash>.json`

`scripts/fetch-gametora.mjs` reads the manifest once and pulls a fixed list of 7 documents
(8 requests per refresh, sequential, with a delay). No crawling, no HTML scraping, no
per-entity requests. These paths are not disallowed by `gametora.com/robots.txt`. Every
downloaded document is recorded in `data/raw/_meta.json` with its source URL and a fetch
timestamp, and each normalized record carries `globalAvailable`, `sourceUrl` and
`lastVerifiedAt`.

### Outbound GameTora links

Every character card carries a validated `gameToraUrl` built from its own `url_name`
slug (never from the English display name) and pointing at
`https://gametora.com/umamusume/characters/<slug>`. GameTora publishes **no per-skill
page** - its skill list renders no anchors and honours no deep-link parameter - so a
skill only gets a URL when a canonical page documents it: a unique skill links to the
page of the character card that owns it (`gameToraUrlKind: 'character'`). Every other
skill is deliberately left non-clickable. Links are real anchors with an external-link
glyph, `target="_blank"` and `rel="noopener noreferrer"`.

### Distance categories

`src/courses/distanceCategory.ts` is the only place a distance is classified. It is
imported by the app and by `scripts/build-data.mjs` (Node type-stripping), so the two
can never disagree.

```
Sprint  1000 - 1400 m
Mile    1500 - 1800 m
Medium  1900 - 2400 m
Long    2500 m and above
```

GameTora's own `distance` enum mislabels 1300 m and 1400 m courses as Mile. The stored
classification always comes from the bands above; the upstream value is kept as
`upstreamDistanceCategory` and every disagreement is reported by the course audit.

### Negative skills

Negative skills - the `×` aptitude skills, acquired bad conditions (Wallflower,
Paddock Fright, Defeatist, Reckless, Packphobia, Ramp Revulsion, Gatekept, ...) and
purple negatives (Blatant Fear) - are dropped at normalization, so they never reach
the simulation, the rankings, a character score, the filters or the recommendations.
A skill counts as negative when **every** effect is bad for its owner and it is not a
debuff aimed at opponents; the per-effect-type sign rules live in
`src/skills/classification.ts` (start-delay and start-reaction invert). Ordinary purple
debuffs that worsen other runners are kept and classified as `category: 'debuff'`.
Currently 50 skills are excluded this way and 52 opponent debuffs are kept.

### Course audit

`scripts/lib/audit-courses.mjs` runs on every build and standalone via
`npm run data:audit`. It reports distance-category mismatches, overlapping or
zero-length sections, sections outside the course, broken phase chains, missing or
invalid inner/outer variants, a final corner after the final straight, out-of-range
spurt starts, impossible section coverage and duplicate course identities.
Current status: **119 courses, 0 errors, 12 warnings** (all of them the GameTora
1300/1400 m Mile mislabel, which we override).

### Global filtering

| Entity | Global signal |
| --- | --- |
| Skill | `unreleased` array does **not** contain `"en"` |
| Character card | has a `release_en` date |
| Racecourse | at least one race running on it is released on the Global server |

Everything else goes into `data/normalized/excluded-non-global.json`, which is **only** loaded
by the *Developer view* toggle and is never merged into a ranking.

Current Global scope: **119 courses, 556 skills, 95 character cards**. No evolution skill has
shipped on Global yet, so the character score currently contains only the unique skill; the
evolution terms are already implemented and will start contributing the moment they release.

`scripts/build-data.mjs` validates every record with zod and rejects malformed or incomplete
entries (run with `--strict` to fail the build on any rejection).

---

## Calculation

All modelling constants live in **one file**: [`src/simulation/config.ts`](src/simulation/config.ts).
Nothing is hard-coded in the engine.

### Simulation

Deterministic, fixed timestep of **1/15 s**. The simulator tracks position, current speed,
target speed, acceleration, race phase, active skills, remaining skill duration, course
sections (corners / straights / uphills / downhills), last-spurt state and remaining stamina.

Key formulas (independent implementation of publicly documented mechanics; no AGPL source was
copied from `mee1080/umasim` or similar projects):

```
phases           = 0 .. d/6 .. 2d/3 .. 5d/6 .. d      (from distance, not from drawn sections)
stats            = overcap(stat) * (1 + 0.02 * mood)  (overcap: >1200 counts at half)
speed            = stats.speed * courseStatBonus + groundSpeedModifier
power            = stats.power + groundPowerModifier
wit              = stats.wit * styleAptitude          (style aptitude scales WIT only)
baseSpeed        = 20 - (distance - 2000) / 1000
targetSpeed(p)   = baseSpeed * strategyCoef[p] + (p == 2 ? sqrt(500 * speed) * distApt * 0.002 : 0)
                 + witSectionVariance + skillModifiers
lastSpurtSpeed   = (targetSpeed(2) + 0.01 * baseSpeed) * 1.05
                 + sqrt(500 * speed) * distApt * 0.002        (NO Guts term on Global)
minSpeed         = 0.85 * baseSpeed + sqrt(200 * guts) * 0.001
acceleration     = accelBase * sqrt(500 * power) * strategyAccel[p] * surfaceApt * distApt
                   accelBase = 0.0006, or 0.0004 while climbing
deceleration     = [-1.2, -0.8, -1.0] by phase; -1.2 when out of stamina
maxHp            = distance + 0.8 * strategyHpCoef * stamina
hpDrain/s        = 20 * (v - baseSpeed + 12)^2 / 144 * ground * (phase >= 2 ? gutsMod : 1)
uphill penalty   = slope/10000 * 200 / power    (target speed, floored at minSpeed)
skill duration   = baseDuration * (distance / 1000)
skill proc rate  = (100 - 9000 / wit) / 100
```

Integration is velocity-Verlet at a 1/15 s tick with sub-frame finish interpolation.
Current-speed skills are a displacement offset (type 22 hands the velocity back on
expiry), acceleration only pays while the runner is below its target speed, and the
last spurt is planned by searching spurt speeds and accepting one with a Wit-driven
probability. Every random draw is seeded.

### Skill evaluation

1. Baseline simulation with no skill, shared by every skill on the course.
2. For every valid activation position, simulate again **with the same seed**, so the
   start delay, Wit variance and spurt-planning rolls are identical (paired
   simulation / common random numbers). Repeated up to 6 times, with an early exit
   once the paired results converge.
3. `timeSaved = baselineTime - skillTime`
4. `metresGained` = the position gap between the two runs **at the same elapsed
   time**, i.e. how far behind the trailing run is when the leader crosses the line
5. `horseLengths = metresGained / 2.5` (see `src/simulation/horseLength.ts`)
6. min / max / average across the sampled positions.
7. `expected = average * activationProbability`
8. `efficiency = expected * 100 / totalCost`, where `totalCost` includes prerequisite skills
   (a gold skill always adds the SP cost of its white base — e.g. Professor of Curvature is
   180 + 180 = **360 SP**).

### Activation modelling

GameTora's condition grammar (`&` = AND, `@` = OR) is parsed into terms and each term is
classified:

* **Static** — decidable from the course / setup / runner (`distance_type`, `ground_type`,
  `rotation`, `running_style`, `track_id`, `season`, `weather`, `ground_condition`,
  `course_distance`, `is_basis_distance`, `is_dirtgrade`, `is_tight_track`, `motivation`,
  `post_number`, `popularity`, …). A failing static term blocks the skill outright, with the
  reason shown in the UI.
* **Positional** — narrows *where* the skill fires: phase, phase halves/quarters, corner N,
  any corner, final corner, final corner second half, straight, home straight, final straight,
  last spurt, uphill, downhill, `remain_distance`, `distance_rate`, `accumulatetime`, and all
  the `*_random` variants (which additionally mark the activation position as random).
* **Probabilistic** — depends on the rest of the field (overtaking, being overtaken, nearby
  runners, blocked, lead, position ranking, rush, start delay, other runners' skills…).
  Resolved from `ACTIVATION_ASSUMPTIONS` in the config file; `order` / `order_rate` use a
  triangular distribution around the assumed running position. Any use of one of these marks
  the result as an **Estimate** in the UI.

`random_lot` is exact (`random_lot<=N` → N %). Preconditions push the earliest activation
point forward and multiply into the probability.

For random-position skills the UI reports the best, the worst and the average activation
result, the share of the duration that was useful and the share wasted by the finish line.

### Reference runner

Speed 1100 / Stamina 900 / Power 900 / Guts 500 / Wit 700, Great mood, A aptitudes,
gate 5, clean start, 12-runner field. Editable in the UI; defaults documented in
`src/simulation/config.ts`.

---

## Course diagram

`src/components/CourseDiagram.tsx` renders a responsive, data-driven SVG strip map
generated entirely from the normalized geometry: start, finish, phase bands, every
corner (with the final corner highlighted), every straight (with the final straight
highlighted), uphills and downhills, plus a metre ruler. Labels sit on the sections
themselves. Sections are focusable and clickable, expose an `aria-label`, and report
their exact metre range in a live caption. The whole figure carries an SVG `<desc>`
text alternative, repeated in a collapsible text description below the map. Expanding
a skill overlays its valid activation region, its sampled activation points, the
effective portion of the effect and the portion wasted past the finish line.

## Known limitations

* **Solo simulation.** There are no opponents. Everything field-dependent is an assumption,
  flagged as an *Estimate*. Position keeping and rushing (kakari) are disabled.
* **Absolute finish times are model-internal.** The rankings compare *differences* against a
  baseline; do not read the raw seconds as in-game race times.
* Downhill acceleration mode is applied as its expected value rather than rolled, to keep the
  simulation deterministic.
* The two "gamble" skills (Nothing Ventured / Risky Business) store a stamina penalty of
  **-100 %**, which the in-game text describes as happening only "sometimes". The engine clamps
  the modelled drain to `SIMULATION.staminaDrainClampFraction` (20 %) and flags them as
  estimates; they still score strongly negative because the reference runner collapses.
* Effects with no solo representation (field of view, lane movement, rush chance, debuff
  immunity, start reaction, random rare skills, reactivate unique skill) contribute 0 and are
  listed as "not modelled" on the skill row.
* Character ranking scores **only the character's own skills** on the selected course. It is
  not a PvP tier list: stats, support cards, inherited factors and race interaction are out of
  scope.

---

## Disclaimer

Unofficial fan project. Uma Musume: Pretty Derby is the property of Cygames. This project is
not affiliated with Cygames or with GameTora, and all numbers come from an independent
simulation — they are a modelling aid, not official values.
