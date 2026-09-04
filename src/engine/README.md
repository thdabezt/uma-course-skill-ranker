# Calculation engine

`vendor/` is a vendored copy of the race solver from
[alpha123/uma-skill-tools](https://github.com/alpha123/uma-skill-tools) (the engine
behind [umalator](https://alpha123.github.io/uma-tools/umalator-global/)), licensed
under the GNU GPL v3 or later (see `vendor/LICENSE`). `vendor/UPSTREAM_COMMIT`
records the upstream commit the copy was taken from.

Local changes to the vendored files are kept to a minimum so the copy can be
re-synced:

* `node:assert` replaced by `vendor/assert.ts` (browser build);
* `const enum` declarations turned into plain `enum`s (isolatedModules);
* the JSON data imports replaced by the `vendor/data.ts` registry, which the app
  fills from its own normalized GameTora data via `adapters.ts`;
* strict-mode type annotations;
* mechanics present in the deployed Global umalator bundle but not yet in the
  public source (spot struggle, unique-level scaling), ported from that bundle and
  marked with `// GLOBAL BUNDLE:` comments;
* two small additions marked `LOCAL:` in `RaceSolverBuilder.ts`: `SkillData.alternative`
  (which condition group a trigger came from) and `withParser()` (a condition table
  with extra assumptions, see `../requirements.ts`).

Everything outside `vendor/` is this project's own code.
