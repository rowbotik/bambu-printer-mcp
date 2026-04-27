# Progress

Working state for the BambuStudio CLI auto-flatten + control-tool work.
Branch: `codex/collar-charm-h2-cleanup`. Nothing committed yet.

## Status snapshot (2026-04-26)

| Area | State |
|---|---|
| TypeScript build | ✅ clean (`npx tsc` exit 0) |
| Unit tests | ✅ 9/9 pass (`tests/slicer/profile-flatten.test.mjs`) |
| CLI smoke H2S | ✅ printable plate gcode (110,970 bytes) |
| CLI smoke H2D | ✅ printable plate gcode (116,704 bytes) |
| CLI smoke X1C | ✅ printable plate gcode (111,415 bytes) |
| CLI smoke P1S | ✅ printable plate gcode (111,313 bytes) |
| End-to-end on real printer | ⏳ not yet run |
| Upstream bug report | ⏳ drafted, not posted |

## What's done

### 1. Profile flattener — `src/slicer/profile-flatten.ts`

Walks BBL `inherits` chain, deep-merges parent → child, and emits CLI-ready
temp configs that work around upstream BambuStudio CLI bugs
([#9636](https://github.com/bambulab/BambuStudio/issues/9636),
[#9968](https://github.com/bambulab/BambuStudio/issues/9968)).

Key behaviors:

- Indexes every `*.json` in `<profilesRoot>/BBL/{machine,process,filament}` by
  `name` field.
- Walks `inherits` recursively (with cycle + missing-parent detection).
- Sets `from: "User"`, `inherits: <leaf machine name>` so the CLI's
  `system_name` resolution lands on a value present in the leaves'
  `compatible_printers` lists. (Source: `BambuStudio.cpp` ~line 2222.)
- Derives `nozzle_volume_type` (array, one entry per nozzle) from
  `default_nozzle_volume_type[]`. Hardware invariant: both nozzles always
  match (validator throws on mismatched array).
- Applies per-printer overlay from `BBL/cli_config.json` (CLI safety
  machine_limits — accel/jerk/speed envelopes).
- Sets `printer_settings_id` / `print_settings_id` /
  `filament_settings_id` from the leaf names so the GUI's project shape is
  mirrored.
- Auto-extends `compatible_printers` to include the chosen machine when the
  user picked a non-default printer/process combo (mirrors GUI save behavior).
- BBL only — explicit error for other vendors.

Public API: `flattenForCli(opts)` and `detectProfilesRoot(slicerPath?)`.

### 2. MCP wire-up — `src/stl/stl-manipulator.ts`

New private method `maybeFlattenBundle()` post-processes the existing
`resolveBambuLikeSettingsBundle()` output. Gated by env var
`BAMBU_CLI_FLATTEN=true`. Default off; backward-compatible.

When enabled:

1. Reads each leaf JSON's `name` field from the bundle paths.
2. If all three (machine, process, filament) resolve to BBL leaves, calls
   `flattenForCli` and replaces the bundle paths with flattened temp paths.
3. On any failure, logs and falls back to the unflattened bundle.

Only affects the `bambustudio` slicer branch. Other slicers untouched.

### 3. Pause / resume MQTT tools

- `src/printers/bambu.ts`: `pauseJob()` and `resumeJob()` (mirror
  `cancelJob`'s `UpdateStateCommand` pattern with `state: "pause"` / `"resume"`).
- `src/index.ts`: `pause_print` and `resume_print` tools registered alongside
  `cancel_print`. Same arg shape (host/serial/token, all optional with env
  fallback).

### 4. Test fixtures — `tests/fixtures/h2d_gui_sliced/`

Saved from your freshly-sliced H2D `.gcode.3mf` so we have GUI ground truth
for any future flattener changes. Three files:

- `project_settings.config` (84 KB, 558 keys — the GUI's flattened output)
- `plate_1.json`
- `slice_info.config`

The original 3MF lives at `docs/mk2 collarID.gcode.3mf.3mf.gcode.3mf` — not
needed for tests (we extracted what we need), can stay un-tracked.

### 5. Smoke test — `scripts/test-cli-slice.mjs`

Standalone runner. Usage:

```bash
node scripts/test-cli-slice.mjs --model h2s|h2d|x1c|p1s [--filament NAME] [--keep-temp]
```

Asserts:

- CLI exits 0.
- Output 3MF exists.
- `Metadata/plate_<n>.gcode` is present and >1 KB.

### 6. Documentation

- `docs/SLICING.md`: rewrote into Path A (GUI, recommended) + Path B (CLI
  flatten, opt-in). Documents the mechanics of Path B and links upstream
  issues.
- `README.md`:
  - Features: pause/resume bullet; auto-slice bullet rewritten to point at
    `BAMBU_CLI_FLATTEN`.
  - Tools: added `pause_print` and `resume_print` sections after
    `cancel_print`.
  - Env var reference: added `BAMBU_CLI_FLATTEN` and `BAMBU_PROFILES_ROOT`.

## Files touched

```
A  PROGRESS.md
A  src/slicer/profile-flatten.ts
A  scripts/test-cli-slice.mjs
A  tests/slicer/profile-flatten.test.mjs
A  tests/fixtures/h2d_gui_sliced/{project_settings.config,plate_1.json,slice_info.config}
A  docs/SLICING.md  (existed before this session, rewritten this session)
M  src/stl/stl-manipulator.ts
M  src/printers/bambu.ts
M  src/index.ts
M  README.md
```

Pre-existing modifications carried over from before this session:
`REMOTE-DEPLOYMENT.md`, `SPEC-CHECKLIST.md`, and the small README cleanup
(Kingpin de-branding, hardcoded path removal). Untouched.

## Don't commit

```
bambu certs/                                # local creds
docs/mk2 collarID.gcode.3mf.3mf.gcode.3mf   # 1.5 MB private artifact
```

Add to `.gitignore` before committing or just stage explicitly.

## Suggested commit message

```
feat: BambuStudio CLI auto-flatten + pause/resume tools

- New src/slicer/profile-flatten.ts: walks BBL inherits chain, derives
  nozzle_volume_type, applies cli_config overlay, sets
  from/inherits/settings_id so the CLI accepts flattened profiles.
  Workaround for upstream BambuStudio issues #9636 / #9968.
- Verified end-to-end on H2S, H2D, X1C, P1S with stock BBL profiles.
- Wired into stl-manipulator behind BAMBU_CLI_FLATTEN=true (default off).
- New pause_print / resume_print MQTT tools alongside cancel_print.
- Docs: SLICING.md split into Path A (GUI) and Path B (CLI flatten),
  README features + tool docs + env var reference updated.
- Test fixtures from a real H2D GUI slice for ground-truth comparison.
- 9 unit tests for the flattener (chain resolution, cycle detection,
  nozzle_volume_type shape, hardware invariant, end-to-end against the
  installed BBL tree).
```

## Queue (not yet started)

### High priority

- **End-to-end test through the actual MCP tool surface.** Spin up the
  server, call `slice_stl` with `BAMBU_CLI_FLATTEN=true`, then `print_3mf`
  with the result, against the H2S/H2D. The standalone smoke covers the
  same code path but doesn't exercise the MCP framing.
- **Post upstream comment on bambulab/BambuStudio#9636.** Dossier drafted
  in conversation; needs polish + posting. Includes:
  - Root-cause walkthrough with line numbers from `BambuStudio.cpp`.
  - Three independent breakages reproduced and resolved.
  - Userland workaround (link to this PR/repo).
  - Offer to upstream a `--auto-flatten` flag.

### Bambuddy-inspired features (per user prioritization)

- **MUST HAVE:** ✅ pause / resume — done.
- **VERY MUCH WANT:** AMS auto-match by RFID. Joins
  `plate_<n>.json.filament_ids` against live `ams.tray.tray_info_idx`
  (e.g. `GFG02`) from `push_status`. Removes the last manual step from
  `print_3mf`. Estimated half a day.
- **Future versions:** AMS RFID re-read tool, skip objects mid-print,
  chamber light/fan/airduct control, AMS dryer start/stop, HMS error
  resource (`printer://{host}/hms`).

## How to verify

```bash
cd ~/Sync/bambu-printer-mcp

# Build + unit tests
npx tsc
node --test tests/slicer/profile-flatten.test.mjs

# Smoke test all four printers
for m in h2s h2d x1c p1s; do
  printf "%-5s " $m
  node scripts/test-cli-slice.mjs --model $m | grep -E "(PASS|OK:|FAIL)"
done
```

Expected: 9/9 unit tests pass, all four smoke tests print "OK: ... bytes of
gcode" and "PASS".
