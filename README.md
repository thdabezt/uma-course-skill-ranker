# Uma Musume Course Skill Ranker (Global)

Racecourse-aware skill and character analysis for *Uma Musume: Pretty Derby* — **Global (EN) version only**.

Pick a racecourse and its race-day conditions, and the site tells you:

* **Speed skills** — how many horse lengths each speed skill is worth on that course, where it fires, whether it carries into the final-leg acceleration, and how much of it the finish line wastes.
* **Acceleration skills** — which accels are *perfect procs* (fire at the final-leg speed jump), *near-perfect*, *delayed*, *early*, a *lottery* (random zone) or simply *do not work* on that course.
* **Character ranking** — characters ordered by the value of their innate unique skill on that course.
* **Stamina calculation** — the stamina a build needs for a full last spurt, with rushing, position keep, spot struggle, downhill mode and recovery skills taken into account.

**Live site: https://thdabezt.github.io/uma-course-skill-ranker/**

---

## Calculation backbone

The race model is the engine from [alpha123/uma-tools](https://github.com/alpha123/uma-tools) — the simulator behind [umalator](https://alpha123.github.io/uma-tools/umalator-global/) — vendored under [`src/engine/vendor/`](src/engine/vendor) (GPL-3.0-or-later, see [`LICENSE`](LICENSE)). On top of the public source it carries the mechanics of the deployed Global build, ported from that build: spot struggle, per-skill RNG streams, unique-level scaling, duration / modifier scaling modes, tag-gated activation counters and the raw-Power Fully Charged hook. `src/engine/README.md` lists every local change.

A skill's value is measured exactly like umalator's skill table: the same seeded race is run with and without the skill and the gap at the finish, divided by 2.5 m, is the gain in horse lengths. `tests/engine.test.ts` checks the port against numbers recorded from umalator-global (31 skills on four courses, all within tolerance).

What this project adds on top of the engine (`src/analysis/`):

* **Activation timing** per skill: where it fired, how far from the 2/3 mark, whether the effect still covered the final-leg or spurt transition (*carryover*), whether it fired while the runner was still accelerating (*shadowed*), how often the finish line cut it short, and its HP cost.
* **Acceleration verdicts**: every accel skill is compared with the same effect fired exactly at the 2/3 mark (the final-leg speed jump, where acceleration is worth the most). ≥85 % of that reference is *perfect*, ≥55 % *near-perfect*, ≥15 % *delayed* or *early*, less is *does not work*. Random zones wider than 120 m are a *lottery* and show the share of runs that kept at least half of the reference.
* **Speed tiers** from the mean gain (S ≥ 1.5 lengths, A ≥ 1, B ≥ 0.5, C ≥ 0.15), capped at B for skills that depend on other runners or fire in fewer than half of the races.
* **Stamina tab**: umalator's stamina calculator (remaining HP, HP required, stamina needed for 50 / 80 / 90 / 95 / 100 % full-spurt rate, downhill savings) plus the rushing rate and its HP cost, the spot-struggle cost for front runners, a stamina sweep and what-if rows for the optional mechanics.
* **Track information**: phases, the 24 sections, position-keep and rush windows, corner numbering, straights, slopes with their speed effect for the current build, stat thresholds, and the final-corner-versus-2/3-mark relation that decides whether corner accels work.

Two analysis passes run in web workers: every skill is screened with 24 paired races, then everything that showed an effect is refined with 120.

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
| `npm test` | Vitest (`EXPLORE=1 npx vitest run tests/explore.test.ts` prints a full verdict sweep) |

`data/normalized/` is committed, so the app runs without a network round-trip. `data/raw/` is gitignored and reproducible via `npm run data:fetch`. A scheduled workflow refreshes it daily (see [Automatic data refresh](#automatic-data-refresh)).

---

## Layout

```
data/raw/            verbatim upstream payloads + _meta.json; data/raw/uma-tools/ holds the engine metadata
data/normalized/     application data model, Global-only + a separate excluded-non-global.json
scripts/             fetch-gametora.mjs, build-data.mjs, audit
src/engine/vendor/   uma-skill-tools engine (GPL), see src/engine/README.md
src/engine/          adapters (app data -> engine), compare (paired races), hpcalc (stamina), runner mapping
src/analysis/        skill analysis + verdicts, skill sets, stamina tab, character ranking
src/courses/         distance categories, track sections, track information
src/skills/          condition parser (UI), classification, effect labels
src/worker/          analysis worker + pool
src/components/      React UI
tests/               Vitest suites
.github/workflows/   ci.yml (typecheck, lint, test), deploy.yml (Pages), refresh-data.yml
```

---

## Deployment

The app is entirely client-side, so it ships as a Next.js static export to GitHub Pages. Every push to `main` runs `.github/workflows/deploy.yml`. Project sites live under `/<repo>`, so the build needs a matching prefix — set by the workflow, and empty in `next dev`:

```bash
NEXT_PUBLIC_BASE_PATH=/uma-course-skill-ranker npm run build
```

### Automatic data refresh

`.github/workflows/refresh-data.yml` runs daily (and on demand from the Actions tab) so newly announced Champions Meeting cups, skills and characters reach the live site without anyone running a command:

1. `npm run data:refresh` pulls the current GameTora payloads and the uma-tools engine metadata and re-normalizes them. The fetcher throws if a manifest key it expects has disappeared, so an upstream layout change fails the run instead of shipping partial data.
2. `data:audit`, `typecheck`, `test` and a full `next build` all have to pass.
3. Only then does it commit `data/normalized/` — and only if something actually changed.
4. It then dispatches `deploy.yml`.

---

## Data sources

Skill, character, racecourse and race data is derived from the **public static JSON that [GameTora](https://gametora.com/umamusume) serves to its own front-end**:

* content-hash manifest: `https://gametora.com/data/manifests/umamusume.json`
* documents: `https://gametora.com/data/umamusume/<key>.<hash>.json`

`scripts/fetch-gametora.mjs` reads the manifest once and pulls a fixed list of documents (sequential, with a delay). No crawling, no HTML scraping, no per-entity requests.

Engine metadata GameTora does not publish — the runner each effect targets, whether a skill rolls the Wit activation check, duration / modifier scaling modes and numeric skill tags — comes from the Global skill table in the [alpha123/uma-tools](https://github.com/alpha123/uma-tools) repository (`umalator-global/skill_data.json`, plain files on `raw.githubusercontent.com`). `build-data.mjs` matches it to GameTora's records by condition text and effect values; conditions and effects agree for every shared skill. Skills unknown upstream fall back to a conservative inference and are flagged `engineSource: 'inferred'` (14 scenario skills today).

### Course layouts

GameTora's `inout` field encodes the layout variant: **1 = single layout, 2 = inner, 3 = outer, 4 = outer then inner** (Hanshin 3200). An earlier version of this project shifted the values by one and labelled Kyoto 1600 (inner) as the outer course; the mapping is now verified against umalator's course list and the real JRA layouts, and `tests/courses.test.ts` pins it. Every layout is a separate course with its own geometry — Kyoto 1600 inner and outer, Kyoto 1400 inner and outer, Niigata 2000 inner and outer.

### Distance categories

`src/courses/distanceCategory.ts` is the only place a distance is classified (Sprint 1000–1400, Mile 1500–1800, Medium 1900–2400, Long 2500+). GameTora's own enum mislabels 1300 m and 1400 m as Mile; the stored classification always comes from the bands.

### Negative skills

Negative skills — the `×` aptitude skills, acquired bad conditions and purple negatives — are dropped at normalization. Ordinary purple debuffs that worsen other runners are kept and classified as `category: 'debuff'`; the engine applies their effects to the other runner only.

### Global filtering

| Entity | Global signal |
| --- | --- |
| Skill | `unreleased` array does **not** contain `"en"` |
| Character card | has a `release_en` date |
| Racecourse | at least one race running on it is released on the Global server |

Everything else goes into `data/normalized/excluded-non-global.json`, which is only loaded by the *Developer view* toggle.

---

## Race model (what the engine simulates)

Fixed timestep of 1/15 s, velocity-Verlet integration, one runner plus a synthetic front-running pacer for position keep. Mechanics live on the Global server as of September 2026 and are all in the engine: start dash, per-section Wit speed variance, rushing (chance and duration from Wit, HP ×1.6), position keep pace-down (HP ×0.6), spot struggle for front runners (Guts-based speed boost, HP ×1.4 / ×3.6 while rushed, ×3.5 / ×7.7 for Runaway), downhill mode (Wit-based chance, +0.3 m/s plus grade/10, HP ×0.4), uphill speed penalty, the Guts term in the last-spurt speed, Fully Charged (Power above 1200: 3 s of extra acceleration when the final leg begins), stat overcap halving above 1200, the last-spurt planner with its Wit-driven acceptance roll, and skill duration scaling with distance. Stamina Contest, Repositioning and Lead Securing are not on Global and are not enabled.

```
baseSpeed        = 20 - (distance - 2000) / 1000
targetSpeed(p)   = baseSpeed * strategyCoef[p] + (p == 2 ? sqrt(500 * speed) * distApt * 0.002 : 0)
lastSpurtSpeed   = (targetSpeed(2) + 0.01 * baseSpeed) * 1.05 + sqrt(500 * speed) * distApt * 0.002
                 + (450 * guts)^0.597 * 0.0001
acceleration     = 0.0006 (0.0004 uphill) * sqrt(500 * power) * strategyAccel[p] * surfaceApt * distApt
maxHp            = 0.8 * strategyHpCoef * stamina + distance
hpDrain/s        = 20 * (v - baseSpeed + 12)^2 / 144 * status * ground * (phase >= 2 ? 1 + 200 / sqrt(600 * guts) : 1)
skill duration   = baseSeconds * distance / 1000
skill proc rate  = max(1 - 90 / wit, 0.2)        (only rolled when "Wit activation checks" is on)
```

Limitations inherited from the engine: skills with cooldowns fire once, conditions that depend on other runners are modelled by probability distributions, lane changes and dueling are not simulated, and the runner's position in the field comes from an assumed order range per running style (front runner 1st, pace chaser 2nd–4th, others 5th–9th of 9).

---

## Disclaimer

Unofficial fan project. Uma Musume: Pretty Derby is the property of Cygames. This project is not affiliated with Cygames, GameTora or uma-tools, and all numbers come from a simulation — they are a modelling aid, not official values.

## License

The calculation engine is GPL-3.0-or-later (© pecan / alpha123), and so is this project as a whole; see [`LICENSE`](LICENSE).
