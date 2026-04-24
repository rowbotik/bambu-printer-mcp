# Bambu Printer Fleet Status Report

Archived note: this file is a point-in-time report from 2026-04-23. Verify live printer state before acting on any status or error listed here.

**Date:** 2026-04-23  
**Time:** 20:41 EDT  
**Reported by:** FRIDAY

---

## 🖨️ Printer Fleet Overview

| Printer | Model | IP | Serial | Status | Current Job |
|---------|-------|-----|--------|--------|-------------|
| **Kingpin** | H2D | 192.168.68.73 | 0948AB4C1900179 | ✅ FINISH (Idle) | None - Last print completed |
| **Parker** | H2S | 192.168.68.93 | 0938AC5B0600334 | ❌ FAILED | Stuck with error 50348044 |
| **X1C** | X1C | 192.168.68.53 | 00M00A2C0617448 | 🔄 Unknown | Not checked |

---

## ⚠️ Critical Issue: Parker (H2S) FAILED State

### Error Details
- **Error Code:** 50348044
- **State:** FAILED (persistent across reboots)
- **File:** `/data/Metadata/plate_1.gcode` (stuck from previous print attempt)
- **Temperatures:** Bed 0°C, Nozzle 0°C, Chamber 32°C
- **WiFi:** -51dBm (good signal)

### What Error 50348044 Means
Based on research, this error on H2S/H2D is related to:
- **Filament extrusion failure** - printer detected it couldn't extrude filament
- **AMS/buffer sensor issues** - filament path obstruction or sensor malfunction
- **Filament loading problems** - tangled spool or stuck filament

### Attempted Fixes (Failed)
1. ✅ `print stop` command via bambu-cli
2. ✅ `cancelJob()` via MCP server
3. ✅ `clean_print_error` via raw MQTT
4. ✅ `resume` command via raw MQTT
5. ✅ Printer reboot via bambu-cli
6. ✅ Waited for cooldown (chamber temp dropped from 33°C to 32°C)

### Recommended Next Steps
1. **Physical inspection required:**
   - Check if filament is stuck in extruder
   - Verify AMS unit is properly connected
   - Check buffer sensor for obstructions
   - Look for broken filament pieces in the path

2. **LCD Panel interaction:**
   - Navigate to error details on printer screen
   - Look for "Clear Error" or "Acknowledge" option
   - May need to manually unload/load filament

3. **If physical clear doesn't work:**
   - Power cycle printer (unplug for 30 seconds)
   - Check Bambu Handy app for error details
   - Contact Bambu support if error persists

---

## ✅ Kingpin (H2D) Status

- **State:** FINISH (successfully completed last print)
- **Progress:** 100% (445/445 layers)
- **File:** `/data/Metadata/plate_1.gcode`
- **Temperatures:** All at ambient (idle)
- **Ready for next job:** YES

---

## 📋 MCP Server Updates (Today's Work)

### H2S/H2D Support Added
**Problem:** `bambu-node` library didn't recognize H2S/H2D serial numbers and couldn't auto-detect model because these printers don't respond to `get_version` MQTT command.

**Solution Implemented:**
1. **Patched `bambu-node`** (node_modules/bambu-node/dist/index.js):
   - Added H2S/H2D to PrinterModel enum
   - Added serial prefix detection (`093` → H2S, `094` → H2D)

2. **Patched `bambu-printer-mcp`** (src/printers/bambu.ts):
   - Added `inferModelFromSerial()` method
   - Model fallback in `connect()` when auto-detection fails
   - Successfully compiled to dist/

**Verification:**
```bash
# Model detection now works
$ node -e "...getStatus('192.168.68.93', '0938AC5B0600334', '<ACCESS_CODE>')"
Model: H2S ✅
Status: FAILED (correctly reporting printer state)
```

### Files Modified
- `node_modules/bambu-node/dist/index.js` - Added H2S/H2D support
- `src/printers/bambu.ts` - Added model inference fallback
- `dist/printers/bambu.js` - Compiled output

---

## 🎯 Active Work Items

### Blocked (Waiting on Parker)
- [ ] Test `.gcode.3mf` print flow on H2S
- [ ] Verify FTPS upload works for H2S
- [ ] Test multi-plate 3MF handling

### Ready to Test (Kingpin available)
- [ ] Test H2D model detection
- [ ] Verify print commands work on H2D
- [ ] Test AMS 2 Pro integration

### Pending Development
- [ ] Add `.gcode.3mf` vs `.3mf` routing logic
- [ ] Fix FTPS session reuse issue
- [ ] Create permanent patch for bambu-node
- [ ] Document H2S/H2D quirks

---

## 📁 Important Paths

| Purpose | Path |
|---------|------|
| MCP Server | `~/Sync/bambu-printer-mcp/` |
| Handoff Doc | `~/Sync/bambu-printer-mcp/archive/handoff.md` |
| This Report | `~/Sync/bambu-printer-mcp/archive/status-report-2026-04-23.md` |
| Printer Config | `~/.config/bambu/config.json` |
| Print Queue | `~/Sync/print-queue/` |
| Test Files | `~/Sync/print-queue/*.gcode.3mf` |

---

## 🔧 Quick Commands

```bash
# Check Parker status
bambu-cli --printer H2S status

# Check Kingpin status  
bambu-cli --printer H2D status

# Reboot Parker
bambu-cli --printer H2S --force reboot

# Test MCP status
node -e "import('./dist/printers/bambu.js').then(m => new m.BambuImplementation().getStatus('192.168.68.93', '0938AC5B0600334', '<ACCESS_CODE>')).then(s => console.log(s.model, s.status))"
```

---

## 📝 Notes

- Parker has been in FAILED state since earlier today (2026-04-23)
- Error persists across reboots - likely requires physical intervention
- Kingpin is ready for production work
- MCP server H2S/H2D patches are working for status/monitoring
- Print job submission still needs testing once Parker is cleared

---

*Report generated by FRIDAY - Fabrication Coordinator*
