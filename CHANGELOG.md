# Changelog

## [1.1.0] – 2026-04-27

### Added
- **BambuStudio CLI auto-flatten** (`BAMBU_CLI_FLATTEN=true`): walks the BBL profile `inherits` chain and emits CLI-ready configs, working around upstream BambuStudio issues [#9636](https://github.com/bambulab/BambuStudio/issues/9636) and [#9968](https://github.com/bambulab/BambuStudio/issues/9968). Verified on H2S, H2D, X1C, P1S.
- **pause_print / resume_print** tools — MQTT pause and resume alongside the existing cancel_print.
- **AMS RFID slot resolution** — `resolve_3mf_ams_slots` dry-run tool matches sliced 3MF filament requirements against live AMS inventory; opt-in `auto_match_ams` flag on `print_3mf`.
- **HMS diagnostics resource** — `printer://{host}/hms` MCP resource for read-only HMS error summary.
- **set_light / set_fan_speed** — MQTT wrappers for chamber light and fan speed control.
- **skip_objects** — list object IDs from a sliced 3MF plate (`list_3mf_plate_objects`) and skip them during a running print (`skip_objects`).
- **Utility controls** — `set_print_speed`, `set_airduct_mode`, `clear_hms_errors`, `reread_ams_rfid`.
- **Bed-aware slicing** — `bed_type` parameter on `slice_stl` and `print_3mf` maps to BambuStudio CLI `--bed-type`.
- **Collar charm wrapper** (`print_collar_charm`) — fixed tray policy for two-colour dog collar charm projects.

### Fixed
- BambuStudio `--load-machine` flag replaced with the correct flag; 3MF inputs now accepted by `get_stl_info`.

## [1.0.5] – prior release

Initial public release with core print, upload, slice, and status tooling.
