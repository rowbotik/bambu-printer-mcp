# Bambu MCP Spec Checklist

Updated: 2026-04-23

This checklist maps `/Users/alexbuchan/Sync/bambu-mcp-server-spec.md` to the current patched state of this local `bambu-printer-mcp` clone.

Status meanings:

- `implemented`: usable now
- `partial`: some of the behavior exists, but not as a clean dedicated tool yet
- `missing`: not implemented in this clone
- `deferred`: intentionally not treated as current truth or needs a design decision first

## 1. Printer Status And Control

| Spec Function | Status | Current Reality | Next Step |
|---|---|---|---|
| `get_printer_status` | implemented | Exists and returns temps, progress, state, current file, AMS/raw data. Does not currently expose WiFi signal explicitly. | Add WiFi fields only if the printer payload actually reports them consistently. |
| `list_printers` | missing | MCP config has separate entries for `bambu-kingpin`, `bambu-parker`, and `bambu-x1c`, but there is no tool that enumerates them. | Add a fleet/config abstraction first, then a `list_printers` tool. |
| `start_print` | partial | `upload_file`, `start_print_job`, and `print_3mf` cover the underlying behavior, but there is no single unified `start_print` tool. | Add a wrapper tool that dispatches to `.3mf` or `.gcode(.3mf)` flow correctly. |
| `pause_print` | missing | No MCP tool yet. | Check supported MQTT command path in `bambu-node` or raw publish format, then add tool. |
| `resume_print` | missing | No MCP tool yet. | Same as pause. |
| `stop_print` | partial | `cancel_print` already exists and stops the current job. | Alias or rename to `stop_print` if you want the spec naming. |
| `get_camera_snapshot` | missing | No camera/thumbnail fetch path yet. | Implement FTPS thumbnail read from `/ipcam/thumbnail/` and return a local temp image path. |

## 2. File Management

| Spec Function | Status | Current Reality | Next Step |
|---|---|---|---|
| `list_files` | partial | `list_printer_files` exists. | Alias if you want the shorter spec name. |
| `delete_file` | missing | No delete tool yet. | Add FTPS delete through existing printer file handling. |
| `upload_file` | implemented | Exists now. | None. |

## 3. AMS Management

| Spec Function | Status | Current Reality | Next Step |
|---|---|---|---|
| `get_ams_status` | implemented | `get_printer_filaments` now returns normalized slot data, tray type, color, remaining %, and resolved slicer profile paths. | None. |
| `get_ams_mapping` | partial | `print_3mf` can read AMS mapping from embedded 3MF settings, but there is no standalone tool that reports active job mapping. | Add a dedicated parser/helper tool for a given 3MF or current job. |
| `set_ams_mapping` | missing | No explicit setter exists. Current flow sets mapping only inside `print_3mf` command payload. | Decide whether this should be a persistent printer state change or just a print-job override tool. |
| `switch_ams_slot` | missing | No tool exists. | Requires confirming the correct live-switch MQTT command path and safety rules. |

Notes:

- Ignore the color table in the original spec as a source of truth. Live MQTT state is authoritative.
- Kingpin is often PETG-heavy, so AMS assumptions should come from `get_printer_filaments`, not hardcoded docs.

## 4. Slicer Integration

| Spec Function | Status | Current Reality | Next Step |
|---|---|---|---|
| `slice_stl` | implemented | Exists now. Also supports `template_3mf_path` and `use_printer_filaments`, including combining template-derived process settings with live MQTT filament selection. | Keep adding regression checks around template-driven collar slicing and multi-object jobs. |
| `slice_3mf` | partial | `slice_stl` already accepts 3MF input, but there is no dedicated `slice_3mf` tool name. | Alias or split only if agents benefit from explicit naming. |
| `get_slice_settings` | implemented | User-facing tool now inspects a 3MF template or JSON/config profile and returns a compact settings summary plus extracted config path. | Add richer output only if agents need more than the current high-signal summary. |
| `set_slice_settings` | missing | No dedicated mutation tool exists. | Decide whether this means editing a profile JSON, a template 3MF, or runtime overrides. |

Supported printers:

- `H2D`: yes
- `H2S`: yes
- `X1C`: yes

Current real state:

- Printer model validation and preset mapping include `h2d`, `h2s`, and `x1c`.
- `template_3mf_path` is accepted by `slice_stl` and `print_3mf`.
- The Orca-first slicing wrapper now succeeds on H2D, H2S, and template-backed P1P smoke tests in this clone.
- `template_3mf_path` no longer disables live printer filament selection. Template process settings and live MQTT filament choice can now be combined in `slice_stl`.
- A lightweight named template registry now exists, backed by `~/Sync/bambu/templates` by default.
- `template_name` can now resolve into `get_slice_settings`, `slice_stl`, and `print_3mf` without requiring raw file paths.
- `save_template` can register local 3MF/JSON/config files into that registry.
- `slice_with_template` now provides the purpose-built “slice this STL using saved template X” wrapper.
- Full collar-production workflow is still only partial because template metadata and save conventions are still lightweight, and the real collar templates have not been regression-tested yet.

## 5. Multi-Printer Support

| Spec Functionality | Status | Current Reality | Next Step |
|---|---|---|---|
| Configurable fleet | partial | Operationally handled by multiple MCP entries in `/Users/alexbuchan/Sync/bambu-mcp-config.json`. | Add a machine-local fleet config file only if you want one MCP server to enumerate and route all printers itself. |
| Route jobs to correct printer | missing | Current model is one MCP entry per printer, not automatic routing. | Define routing rules first, then add a dispatcher layer. |
| H2D/H2S/X1C support | implemented | All three are working connection-wise in this patched clone. | None. |
| Config in `~/.config/bambu/config.json` | missing | Current setup uses MCP env vars per server entry, not a unified config file. | Only add this if it simplifies remote deployment more than the current split entries. |

Recommendation:

- Keep one MCP server entry per printer for now.
- Only build unified fleet routing after slicing/templates are stable.

## 6. Template System

| Spec Function | Status | Current Reality | Next Step |
|---|---|---|---|
| `list_templates` | implemented | Lists named templates from the local registry, defaulting to `~/Sync/bambu/templates`. | Add richer metadata only if agents need more than name/path/type. |
| `apply_template` | implemented | `slice_with_template` now wraps named-template slicing, while `template_name` also resolves in the lower-level tools. | Add metadata if agents need richer template selection than name/path/type. |
| `save_template` | implemented | Saves `.3mf`, `.json`, and `.config` files into the registry under a template name. | Add metadata sidecars only if needed. |

Template storage:

- Current default: `~/Sync/bambu/templates/`
- Overrideable via `BAMBU_TEMPLATE_DIR`

Recommended direction:

1. Treat a template as a saved 3MF project plus lightweight metadata.
2. Use the 3MF as the source of truth for process/profile defaults.
3. Keep AMS role defaults separate from live AMS inventory.

## Auth

| Spec Item | Status | Current Reality | Next Step |
|---|---|---|---|
| Access code auth | implemented | Working for current MQTT/FTPS flows. | None. |
| Certificate-based auth | deferred | Separate workstream. The current repo patch does not implement the Bambu Connect cert flow. | Only revisit if newer firmware forces this path for the printers you actually use in MCP. |

## Highest-Value Next Work

1. Add regression checks using the real collar templates once they are saved.
2. Add `list_printers` if you still want one MCP to enumerate the fleet.
3. Add camera snapshot and file delete as low-risk utility tools.
4. Add pause/resume only after confirming the correct MQTT commands.

## Recommended Agent-Facing Surface

If the goal is “what should agents actually use most,” the practical high-value tool set is:

- `get_printer_status`
- `get_printer_filaments`
- `list_printer_files`
- `upload_file`
- `slice_stl`
- `print_3mf`
- `cancel_print`
- `set_temperature`

That covers the real near-term workflow:

1. Render STL from SCAD.
2. Read live filament inventory.
3. Slice with template/profile plus live filament-aware defaults.
4. Upload and print.
