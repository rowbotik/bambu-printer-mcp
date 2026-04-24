# Remote Deployment Notes

Updated: 2026-04-22

This document records the local patches made to this clone of `bambu-printer-mcp`, what was verified against the live printers, and how to deploy the patched server on a remote machine.

Access tokens are intentionally omitted from this document. The synced MCP config currently contains them, but this README avoids repeating secrets.

## What Changed

### MQTT status handling

Files:

- `src/printers/bambu.ts`
- `dist/printers/bambu.js`

Changes:

- Added a tolerant `BambuClient` subclass that subscribes to `device/<serial>/report` without requiring the legacy `get_version` ACK.
- Added a report cache keyed by `host + serial + token`.
- Waited for the first real `push_status` report instead of relying on `printer.data` immediately after connect.
- Kept the fire-and-settle helper for commands that do not ACK reliably on newer firmware.

Why:

- H2D and H2S firmware can stream live status over MQTT while never answering the `bambu-node` `get_version` handshake.
- Without this patch, the connection looked broken even though the printer was already sending valid reports.

### Environment variable compatibility

Files:

- `src/index.ts`
- `dist/index.js`

Changes:

- Added support for:
  - `BAMBU_PRINTER_HOST`
  - `BAMBU_PRINTER_SERIAL`
  - `BAMBU_PRINTER_ACCESS_TOKEN`
  - `BAMBU_PRINTER_MODEL`
  - `BAMBU_STUDIO_PATH`
- Kept compatibility with the original names:
  - `PRINTER_HOST`
  - `BAMBU_SERIAL`
  - `BAMBU_TOKEN`
  - `BAMBU_MODEL`
  - `SLICER_PATH`

Why:

- The real MCP config in `/Users/alexbuchan/Sync/bambu-mcp-config.json` already used the `BAMBU_PRINTER_*` naming pattern.
- Accepting both naming schemes avoids rewriting every caller.

### H2S model support

Files:

- `src/index.ts`
- `dist/index.js`
- `README.md`

Changes:

- Added `h2s` to model validation.
- Added the `Bambu Lab H2S <nozzle> nozzle` slicer preset mapping.
- Added `h2s` to the interactive model picker and tool schema enums.

Why:

- Parker is an H2S. Without this patch, the server would reject its configured model before slicing or printing.

### Per-printer MCP split

File:

- `/Users/alexbuchan/Sync/bambu-mcp-config.json`

Changes:

- Replaced the single `bambu` MCP entry with:
  - `bambu-kingpin`
  - `bambu-parker`
  - `bambu-x1c`
- Pointed each entry at this patched clone:
  - `node /Users/alexbuchan/Desktop/bambu-printer-mcp/dist/index.js`

Why:

- One MCP entry per device is simpler and safer than constantly overriding host, serial, and token per tool call.

### Live filament inventory resolution

Files:

- `src/index.ts`
- `dist/index.js`

Changes:

- Added `get_printer_filaments` to normalize live AMS tray data from MQTT.
- Resolved printer-reported `tray_info_idx` values like `GFG02` or `GFL00` to matching BambuStudio filament profile JSON paths for the configured model.
- Added a simple single-material slicing fallback: when `slice_stl` has no explicit slicer profile or `load_filaments`, it uses the printer's current or first loaded tray as the slicer filament profile.
- Template-driven slicing and live MQTT filament selection now work together, so a saved 3MF can supply process settings while the active printer tray supplies the material choice.

Why:

- The collar workflow needs live filament awareness before slicing, not just after a 3MF is already created.
- Raw MQTT AMS data is useful but too low-level for an agent; this patch turns it into direct slicer inputs.

## Printer Inventory

These are the deployed logical printer names used in the config:

| Name | Model | Host | Serial |
|---|---|---|---|
| Kingpin | H2D | `192.168.68.73` | `0948AB4C1900179` |
| Parker | H2S | `192.168.68.93` | `0938AC5B0600334` |
| X1C | X1C | `192.168.68.53` | `00M00A2C0617448` |

## What Was Verified

Live status checks were run against all three printers on 2026-04-22.

Results:

- Kingpin: connected, reported `IDLE`, returned live temperatures and AMS data.
- Parker: connected, reported `IDLE`, returned live temperatures.
- X1C: connected and returned status successfully; the printer-reported state was `FAILED` at the time of the check, which is a printer state, not an auth failure.
- `getFiles()` worked against Kingpin and returned the expected printer directories.
- Live filament resolution produced slicer-ready paths such as `Bambu PETG HF @BBL H2D 0.4 nozzle.json`, `Bambu PETG Translucent @BBL H2S.json`, and `PolyLite PLA @BBL X1C.json`.

Important note:

- `model` in the returned status can still show `Unknown` on these push-only reports because `model_id` is blank in the payload and the tolerant path intentionally skips the `get_version` model probe. This does not block status, file, or command operations.

## Current Local Layout

- Patched repo:
  - `/Users/alexbuchan/Desktop/bambu-printer-mcp`
- Synced MCP config:
  - `/Users/alexbuchan/Sync/bambu-mcp-config.json`
- Current command used by the synced config:
  - `node /Users/alexbuchan/Desktop/bambu-printer-mcp/dist/index.js`

## Remote Deployment Plan

### Option A: Mirror the same path

This is the easiest path.

1. Copy the patched repo to the remote machine at:
   - `/Users/alexbuchan/Desktop/bambu-printer-mcp`
2. On the remote machine, install runtime dependencies in that repo:
   - `npm install --omit=dev`
3. Keep the synced `bambu-mcp-config.json` as-is.
4. Restart the MCP host or client.
5. Smoke test:
   - `get_printer_status` on `bambu-kingpin`
   - `get_printer_status` on `bambu-parker`
   - `get_printer_status` on `bambu-x1c`
   - `list_printer_files` on at least one printer

### Option B: Deploy to a different path

Use this if the remote machine should not mirror the Desktop path.

1. Copy the patched repo anywhere on the remote machine.
2. Run:
   - `npm install --omit=dev`
3. Update each Bambu MCP entry in the remote config so `command` points at the new path, for example:
   - `node /opt/bambu-printer-mcp/dist/index.js`
4. Restart the MCP host or client.
5. Run the same smoke tests listed above.

### Option C: Package or publish later

This was not done in this rollout.

Possible later cleanup:

- publish a private fork
- create a local tarball package
- install the patched clone in a stable machine-local location instead of running from Desktop

## Recommended Remote Rollout

If the goal is to get the remote station working with minimum risk:

1. Copy this exact repo to the remote machine.
2. Install runtime dependencies there with `npm install --omit=dev`.
3. Update the Bambu MCP `command` path on the remote machine if needed.
4. Restart the MCP client.
5. Verify status on all three printers before attempting any file upload or print command.
6. Only after status works, test:
   - `list_printer_files`
   - a harmless temperature read
   - a file upload on a non-critical test file

## Operational Notes

- `tsc` was not available in this local clone while patching, so both `src/` and `dist/` were edited directly. The checked-in runtime is the source of truth for deployment unless the remote machine rebuilds the project.
- The synced config currently stores printer secrets. Long term, a better design is to keep the tokens machine-local and inject them from an unsynced config or wrapper.
- Reverting the MCP config back to `npx -y bambu-printer-mcp` will also revert the H2D/H2S compatibility work, because the published package does not include these local patches.

## Files Touched In This Rollout

- `src/printers/bambu.ts`
- `dist/printers/bambu.js`
- `src/index.ts`
- `dist/index.js`
- `README.md`
- `REMOTE-DEPLOYMENT.md`
- `/Users/alexbuchan/Sync/bambu-mcp-config.json`
