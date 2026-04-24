---
name: H2S/H2D Printer Support
description: In-progress work to support Bambu H2S (Parker) and H2D (Kingpin) printers; patches applied, with historical printer-state notes retained for context
type: project
---

Added H2S/H2D support (serial prefixes 093/094) as of 2026-04-23. Work is partially done.

**Why:** H2S/H2D don't respond to `get_version` MQTT round-trip that bambu-node uses for model detection, so the library crashes. Also `.gcode.3mf` files need printer-family-specific routing: P1/A1/X1 use `gcode_file`, while H2S/H2D use `project_file`.

**How to apply:** When working on print or MQTT features, be aware these printers need the model-from-serial fallback and a different print command path.

## Patches applied (but not permanent)
- `node_modules/bambu-node/dist/index.js` — added H2D/H2S to PrinterModel enum + serial prefix detection (093→H2S, 094→H2D). **This is a node_modules patch — will be lost on npm install.**
- `src/printers/bambu.ts` — added `inferModelFromSerial()` and model fallback after MQTT connect.

## Blocking issues
- Parker (H2S, IP 192.168.68.93, serial 0938AC5B0600334) was in FAILED gcode_state during the 2026-04-23 debugging run; verify live state before treating this as current.
- FTPS uploads previously failed with "session reuse required"; this fork now waits for TLS session reuse in its upload path.
- `.gcode.3mf` print flow not yet tested.

## Printers
- Parker (H2S): IP 192.168.68.93, serial 0938AC5B0600334, access code `<redacted>`
- Kingpin (H2D): IP 192.168.68.73, serial 0948AB4C1900179, access code `<redacted>`

## Remaining work
1. Verify Parker's current live state before print testing
2. Keep FTPS TLS session reuse covered by regression or smoke checks
3. Keep `.gcode.3mf` routing covered by regression tests: P1/A1/X1 use `gcode_file`; H2S/H2D use `project_file`
4. Make bambu-node patch permanent (fork, PR, or patch script)
5. Test Kingpin (H2D)
