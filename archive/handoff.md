# Bambu Printer MCP - H2S/H2D Support Handoff

Archived note: this file preserves a 2026-04-23 debugging handoff. It is not the current operational runbook; use the root `README.md`, `REMOTE-DEPLOYMENT.md`, and `SPEC-CHECKLIST.md` for current guidance.

## Date: 2026-04-23
## Author: FRIDAY

---

## What We're Trying To Do

Enable the `bambu-printer-mcp` server to fully support **Bambu Lab H2S** and **H2D** printers (Parker and Kingpin) for automated print job submission via MCP tools.

---

## The Core Problem

### 1. H2S/H2D Don't Respond to `get_version`

Unlike X1C/P1P/A1 printers, H2S/H2D firmware **never answers the `get_version` MQTT round-trip** that `bambu-node` uses to auto-detect the printer model. The library waits for module info (including serial number prefix) but H2S/H2D only stream `push_status` immediately after subscribe.

**Result:** `bambu-node` throws `"Printer model not supported!"` because it can't map the serial to a model.

### 2. `.gcode.3mf` Files Need Different Handling

Pre-sliced `.gcode.3mf` files (exported from Bambu Studio with embedded gcode) need printer-family-specific handling:
1. Uploaded via FTPS to `/cache/`
2. Started with `gcode_file` on P1/A1/X1 printers, or `project_file` on H2S/H2D printers

The earlier assumption that all `.gcode.3mf` files must avoid `project_file` was stale. H2S/H2D firmware accepts `project_file` for `.gcode.3mf` containers because it reads the embedded `Metadata/plate_1.gcode` path directly.

### 3. H2S/H2D Serial Prefixes Not in `bambu-node`

The `bambu-node` library only recognizes:
- `00M` → X1C, `00W` → X1, `03W` → X1E
- `01S` → P1P, `01P` → P1S
- `030` → A1, `039` → A1M

**Missing:** `093` → H2S, `094` → H2D

---

## Changes Made

### 1. Patched `bambu-node` (node_modules)

**File:** `node_modules/bambu-node/dist/index.js`

Added H2S/H2D to `PrinterModel` enum:
```javascript
var p;(function(e){e.X1C="X1C",e.X1="X1",e.X1E="X1E",e.P1P="P1P",e.P1S="P1S",e.A1="A1",e.A1M="A1M",e.H2D="H2D",e.H2S="H2S"})(p||(p={}));
```

Added serial prefix detection:
```javascript
else if(i.sn.startsWith("093"))this._printerData.model=p.H2S;
else if(i.sn.startsWith("094"))this._printerData.model=p.H2D;
```

### 2. Patched `bambu-printer-mcp/src/printers/bambu.ts`

Added `inferModelFromSerial()` method to `TolerantBambuClient`:
```typescript
private inferModelFromSerial(): string | undefined {
  const sn = this.config.serialNumber;
  if (sn.startsWith("093")) return "H2S";
  if (sn.startsWith("094")) return "H2D";
  if (sn.startsWith("00M")) return "X1C";
  if (sn.startsWith("00W")) return "X1";
  if (sn.startsWith("03W")) return "X1E";
  if (sn.startsWith("01S")) return "P1P";
  if (sn.startsWith("01P")) return "P1S";
  if (sn.startsWith("030")) return "A1";
  if (sn.startsWith("039")) return "A1M";
  return undefined;
}
```

Added model inference in `connect()` after MQTT connection:
```typescript
// H2S/H2D printers don't respond to get_version with module info.
// Infer model from serial number prefix so downstream code works.
if (!this.data.model) {
  const inferred = this.inferModelFromSerial();
  if (inferred) {
    (this.data as any).model = inferred;
    this.emit("printer:dataUpdate", this.data, { model: inferred } as any);
  }
}
```

### 3. Built Successfully

```bash
npm run build
```

Compiled to `dist/printers/bambu.js` with H2S/H2D support.

---

## Current Status

### ✅ Working
- **Model detection:** H2S now correctly identified from serial prefix
- **Status polling:** `getStatus()` returns correct data including temperatures, AMS state
- **MQTT connection:** Stable connection to H2S without `get_version` timeout

### ❌ Not Working
- Historical note: Parker was previously in FAILED state during this debugging run.
- `.gcode.3mf` routing has since been updated: P1/A1/X1 use `gcode_file`; H2S/H2D use `project_file`.
- FTPS session reuse has since been addressed in this fork's upload path.

---

## Next Steps

### Immediate
1. **Clear Parker's FAILED state** - likely needs LCD panel interaction or power cycle
2. **Test `.gcode.3mf` print flow** once printer is idle:
   - Upload via FTPS to `/cache/`
   - Send the printer-family-appropriate command (`gcode_file` for P1/A1/X1, `project_file` for H2S/H2D)
   - Verify print starts successfully

### Short Term
3. **Fix FTPS session reuse** - may need to adjust FTP client settings for TLS session reuse
4. **Add `.gcode.3mf` detection** in MCP server to route to correct command:
   - If file ends in `.gcode.3mf` → use `print` command
   - If file ends in `.3mf` (no gcode) → slice first, then use `project_file` command
5. **Make `bambu-node` patches permanent** - either:
   - Fork `bambu-node` and publish with H2S/H2D support
   - Submit PR to upstream
   - Maintain local patch file

### Long Term
6. **Test with Kingpin (H2D)** - verify same fixes work for H2D
7. **Add H2D-specific features** - dual extruder support, AMS 2 Pro features
8. **Document printer-specific quirks** in MCP server docs

---

## Files Modified

| File | Change |
|------|--------|
| `node_modules/bambu-node/dist/index.js` | Added H2S/H2D to PrinterModel enum and serial detection |
| `src/printers/bambu.ts` | Added `inferModelFromSerial()` and model fallback in `connect()` |
| `dist/printers/bambu.js` | Compiled output with H2S/H2D support |

---

## Test Commands

```bash
# Test status (working)
cd ~/Sync/bambu-printer-mcp && node -e "
import { BambuImplementation } from './dist/printers/bambu.js';
const bambu = new BambuImplementation();
const status = await bambu.getStatus('192.168.68.93', '0938AC5B0600334', '<ACCESS_CODE>');
console.log('Model:', status.model, 'State:', status.status);
"

# Test print (blocked - printer in FAILED state)
# TODO: Once cleared, test with:
# bambu.print3mf('192.168.68.93', '0938AC5B0600334', '<ACCESS_CODE>', '/path/to/file.gcode.3mf')
```

---

## References

- **Parker (H2S):** IP `192.168.68.93`, Serial `0938AC5B0600334`, Access Code `<redacted>`
- **Kingpin (H2D):** IP `192.168.68.73`, Serial `0948AB4C1900179`, Access Code `<redacted>`
- **bambu-node:** https://github.com/tobiasbischoff/bambu-cli (tobiasbischoff version)
- **darkorb's script:** https://github.com/darkorb/bambu-ftp-and-print (for `.gcode.3mf` handling)

---

*Precise. Quiet. Handled.*
