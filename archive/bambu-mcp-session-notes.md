# bambu-printer-mcp session notes

Archived note: this file preserves release-session notes from 2026-04-23. Use the root docs for current setup and operational guidance.

Date: 2026-04-23

## What we shipped

### 1.0.8 — FTPS TLS session reuse fix
Bambu printers require the FTPS data channel to reuse the control connection's TLS session. With TLS 1.3, the session ticket arrives asynchronously. If `getSession()` is called before the `session` event fires it returns `undefined`, causing a fresh TLS negotiation that the printer rejects. Added `waitForTlsSession()` in `ftpUpload()` to wait up to 1s for the ticket before opening any data connections.

### 1.0.9 — H2S/H2D: use project_file for .gcode.3mf
On P1/A1/X1 printers, `project_file` returns error 405004002 for `.gcode.3mf` containers, so those printers use `gcode_file`. On H2S/H2D, `gcode_file` is not supported — the firmware returns "Error: unknown". Fixed by detecting H2S/H2D from the serial prefix (`093`/`094`) and letting `.gcode.3mf` fall through to the `project_file` path, which works because H2S firmware opens the zip and reads `Metadata/plate_1.gcode` directly.

### 1.0.10 — Double-extension filename normalisation
BambuStudio CLI appends `.gcode.3mf` to the output filename even when the input already has that extension, producing `Cube.gcode.3mf.gcode.3mf`. The H2S firmware can't identify the container format from the double extension and silently does nothing. Fixed by stripping the duplicate suffix before upload so the remote file is always `Cube.gcode.3mf`.

## Printers
| Model | IP | Serial | Access code |
|---|---|---|---|
| H2D | 192.168.68.73 | 0948AB4C1900179 | `<redacted>` |
| H2S (Parker) | 192.168.68.93 | 0938AC5B0600334 | `<redacted>` |
| X1C | 192.168.68.53 | 00M00A2C0617448 | `<redacted>` |

## npm publish
Requires a Classic Automation token (not Publish, not granular) — only Automation tokens bypass 2FA.
Workflow: `echo "//registry.npmjs.org/:_authToken=TOKEN" > .npmrc && npm publish --access public; rm .npmrc`

## Still to verify
- End-to-end print of `.gcode.3mf` on Parker (H2S) with 1.0.10
- H2D certificate-auth path, only if a target firmware requires it
