# Legacy GPP semantics — what we know and how we know it

Achar's contract is byte-parity with the output of SolidCAM's legacy GPP
post (`Siemens_828D_Milling_4A.gpp` and variants). The GPP language is
undocumented for our purposes, so every behavioral rule below was
established **empirically**: by diffing Achar's output against recorded
legacy output for real production jobs under `fixtures/`.

Treat this file as the project's institutional memory. When a new fixture
breaks parity, the fix almost always ends with a new rule here. A rule
without a fixture that proves it is a guess — say so explicitly.

Terminology: "trace" is SolidCAM trace-mode-5 output; "reference" is the
G-code the legacy GPP produced for that same trace; N-numbers are the
`N<number>` block-number prefixes.

---

## Trace format facts

### T/F change flags

Numeric parameters in the trace carry a `T` or `F` suffix
(`xpos:183.00000T`, `ypos:0.00000F`). The parser exposes these as
`<key>__changed: boolean` alongside the value. `T` means SolidCAM
considers the parameter changed for this event — **even when the numeric
value equals the machine's current position**. This distinction is
load-bearing: several legacy behaviors emit or suppress words based on
the flag, not on numeric comparison (see rules 1 and 3).

Access them via `siemens828dPolicy.traceChanged(params, key)`, which
returns `true`/`false` for explicit flags and `undefined` when the trace
carried no flag.

### Job repetition

The same job (same `original_job_name`) can start multiple times in one
trace, for two different reasons with opposite file semantics:

- **Rotary pattern instances** — `used_in_transform_4x: 1`. The job body
  repeats once per rotary position (A angle).
- **Re-posts / translate patterns** — `used_in_transform_4x: 0`, usually
  `used_in_transform_translate: 1`. SolidCAM re-emits the whole job.

Rule 4 covers what legacy GPP does with the output file in each case.

---

## Rules

### Rule 1 — Approach repeats trust the trace flags, except in drill jobs

**Statement.** At a job start *without* a tool change, the first `move_5x`
repeats the approach coordinates (`X.. Y.. [A..]` block, then `Z..`) for
every coordinate the trace flags as changed — even when the values are
numerically identical to the position the job-start block just emitted.
In **drill** jobs (`job_type` contains `drill`), the repeat is suppressed
for numerically unchanged coordinates instead.

**Evidence.**
- `fixtures/PROJECT_434.../reference/Debur_target.SPF` lines ~14–17: the
  job-start block emits `X183 Y0 A61.915`, then after `S6000`/`M3` the
  reference emits `X183 Y0 A61.915` **again** followed by `Z57.29603`.
  The move_5x event (#161977 in the trace) has all `__changed` flags
  true while every value equals the current position.
- `fixtures/PROJECT_2541021.../reference/D_drill7.SPF` (drill job, 4x
  pattern): the equivalent move_5x goes straight to `Z145.15283` — no
  X/Y/A repeat.

**Implementation.** `post.ts`, Move5x handler, first branch
(`approachChanged` helper: `changedOrDifferent` for non-drill jobs,
`!sameNumber` for drill jobs).

### Rule 2 — After a tool change, the approach move emits only Z

**Statement.** When the job *did* have a tool change, the job-start block
already emitted the full position (`G0 G<home> G90 X.. Y.. [A..]`), and
the first approach `rapid_move`/`move_5x` descends to clearance Z only.
X/Y/A carried by that event are discarded, regardless of change flags.

**Evidence.**
- `fixtures/PROJECT_434.../reference/4X_PC_faces1.SPF` line ~23: after
  the toolchange job start, `M3` is followed directly by `Z47.20585`,
  even though the move event carries flagged X/Y/A values.
- Same pattern in every `D_drill*` file of `PROJECT_2541021` whose
  instance follows a `ChangeTool`.

**Implementation.** `post.ts`: RapidMove handler branch guarded by
`state.currentJobHadToolChange`, and the mirroring branch added to the
Move5x handler (commit `122be8e`).

### Rule 3 — In ordinary rapids, an explicit changed=true flag wins over numeric equality

**Statement.** Outside the approach context, a rapid emits a coordinate
word when the trace flags it changed, even if the value matches
`lastPosition` within tolerance. Numeric comparison is only the fallback
when the trace carries no flag.

**Evidence.** `fixtures/PROJECT_567.../reference/F_contour1.SPF` lines
31/43/55: reference emits `G0 X61.55 Y-45.47601` where Y equals the
current position numerically but is flagged `T` (rounding differences —
`-45.4760057628` in the trace vs `-45.47601` rendered).

**Implementation.** `post.ts`: RapidMove and Move5x default paths — every
axis guard has the shape
`changed === true || (changed !== false && !sameNumber(...))`.
The `apos` guard follows the same shape (previously numeric-only).

### Rule 4 — File reopen: rotary patterns append, everything else replaces (N-numbers stay consumed)

**Statement.** When a job with the same file name starts again:

- `used_in_transform_4x: 1` → the new instance **appends** to the same
  SPF; the file accumulates one section per rotary position.
- otherwise (re-posts, translate patterns) → the new instance **replaces**
  the file's content. Crucially, the discarded first write's N-numbers
  remain consumed: numbering is a single global monotonic counter, so the
  final file starts at whatever N the *last* write began at, and there is
  a hole in the global N-sequence where the discarded content used to be.

**Evidence.**
- Replace: `fixtures/PROJECT_434.../reference/HSS_PC_Lin_faces2.SPF`
  starts at `N74680`; N1960–N74670 exist in **no** reference file — they
  were burned by the discarded first write. The MPF still EXTCALLs the
  file twice.
- Append: `fixtures/PROJECT_2541021.../reference/iRough_faces.SPF` and
  `F_contour6.SPF` contain every pattern instance back-to-back (2,618 and
  2,220 more lines than a single instance).

**Implementation.** `post.ts`, StartOfJob:
`fileMode = jobFiles.has(name) && used_in_transform_4x ? 'append' : 'replace'`.
The Builder's global line counter provides the burned-numbers behavior
for free.

### Rule 5 — 4x-transform jobs keep the A-word out of the subprogram

**Statement.** For `used_in_transform_4x` jobs, the job-start block in the
SPF omits the A-word; the rotary position is emitted in the **main file**
(before the EXTCALL, at EndOfJob) and per-hole by drill-cycle blocks
(`G0 A..`). Non-transform jobs with a rotary axis emit A in the SPF
job-start block (and in approach repeats, per rule 1).

**Evidence.** Compare `4X_PC_faces1.SPF` (A only via main-file/`G0 A..`
lines) with `Debur_target.SPF` (`X183 Y0 A61.915` inside the SPF) in
`PROJECT_434`.

**Implementation.** `post.ts`: StartOfJob `emitStartPosition` block
(`!params.used_in_transform_4x` guard on the A word), EndOfJob A-word
emission before `callSubprogram`, and the `!used_in_transform_4x` guard
on the A word in Move5x branch 1.

### Rule 6 — A same-tool "tool change" repeats the modal spindle speed

**Statement.** The job-start block after a tool change emits an S word.
When the change loads a **different** tool, the S value is the new job's
`spin_rate`. When it re-loads the tool that is already active (same
`tool_number`), legacy repeats the spindle speed that is currently modal
— typically the *previous* job's speed — and the job's real speed is set
later by its `m_feed_spin` event.

**Evidence.** `fixtures/PROJECT_26646_CAM_Milling`: `HSS_PC_CZ_faces`
(spin_rate 3700) and `iRough_faces` (spin_rate 7836) interleave 7 times,
both using tool `END6Z4`. The reference SPFs show the job-start S values
**swapped** relative to each job's own spin_rate (`HSS...` line 11 is
`S7836`, `iRough...` line 11 is `S3700`) — each carries the speed left
active by the other. Emitting the carried speed *unconditionally* breaks
all four other fixtures (2551019 went 0 → 48 different), which pins the
rule to same-tool reloads only.

**Implementation.** `post.ts`, StartOfJob toolchange branch
(`sameToolReloaded` guard on `state.lastSpindleSpeed`, which is updated
by MFeedSpin, Drill, and the job-start emission itself).

### Rule 7 — Drill jobs do not defer the job-start Z

**Statement.** Non-drill jobs defer their initial Z to the first motion
event (`deferredJobStartZ`); drill jobs emit positioning through the
drill-cycle machinery instead. This is why drill and contour jobs take
different approach branches even under identical flag conditions.

**Evidence.** Structural: every drill SPF in all four fixtures goes
job-start block → `Z<clearance>` → `Z<retract>` → `M8` → cycle blocks,
with no deferred-Z interaction.

**Implementation.** `post.ts`, StartOfJob:
`state.deferredJobStartZ = !isDrillJob(params)`.

### Rule 8 — Tapping cycles do not repeat the drill-approach Z

**Statement.** The `drillApproachZBeforeCoolant` repeat (rule from the
Drill handler: re-emit Z when the trace flags it changed even if the
prior rapid already positioned there) applies to ordinary drill cycles
only. Tapping cycles (`drill_cycle_name === 'CYCLE84'`) never repeat that
Z, even though the trace carries the same `zpos__changed: true` flag as
an ordinary drill.

**Evidence.** `fixtures/PROJECT_AG_BIG_SABET_CAM_Milling/reference/D_drill_4.SPF`:
`RapidMove` positions `Z80`, the following `Drill` event (CYCLE84,
zpos also 80, also flagged changed) does **not** repeat it — legacy goes
straight `M3` → `M8`. The generated output duplicated `Z80` before this
fix, cascading N-numbers through the entire file.

**Implementation.** `drilling.ts`, Drill handler: added
`params.drill_cycle_name !== 'CYCLE84'` to the approach-Z condition.

### Rule 9 — Tapping cycles get an unconditional optional stop, machine-gated

**Statement.** On machines with the `tapCycleOptionalStop` feature, every
`CYCLE84` call is preceded by `M1` (optional stop), immediately after the
feed word — unconditionally, with no corresponding trace flag. Machines
without the feature never emit it.

**Evidence.** `fixtures/PROJECT_AG_BIG_SABET_CAM_Milling/reference/D_drill_4.SPF`
and `D_drill2_2.SPF` (both PoyaKar-machine fixtures): every `CYCLE84` is
preceded by `M1`, always, regardless of trace fields on the `Drill` event
(none differ between M1 and non-M1 occurrences). `fixtures/PROJECT_2541021_CAM_Milling/reference/D_drill8_1.SPF`
(default Siemens profile, no machine profile): four `CYCLE84` calls,
**never** preceded by `M1`, with near-identical `C84_*` job parameters to
the PoyaKar case — ruling out a trace-driven explanation and pointing to
a machine-level default instead.

**Implementation.** New `MachineProfileFeatures.tapCycleOptionalStop`
flag (`machine-profile.ts`); `drilling.ts` DrillPoint handler emits
`$.OptionalStop()` before the cycle call when the feature is on and
`drill_cycle_name === 'CYCLE84'`. Enabled on `PoyaKar_1160L_3A.machine.json`.

### Rule 10 — The tool-list comment uses SolidCAM's short tool name, not the selection id

**Statement.** The `; T<number>-<name>` lines in the "Tools Used In This
Program" comment block (main-file, `mainToolListComments` feature) use
`tool_message` — SolidCAM's short display name — not `tool_id_string`,
which is what `T="..."` tool-selection words use elsewhere. The two
diverge whenever the tool carries a length/variant suffix.

**Evidence.** `fixtures/PROJECT_AG_BIG_SABET_CAM_Milling`: tool
`tool_id_string:'END12Z4L'` has `tool_message:'END12Z4'`; the reference
main-file comment reads `; T157-END12Z4` (no `L`), while the same tool's
`T="END12Z4L" M6` selection line keeps the full id. Same pattern for
`TAPM12X1`/`TAPM12` and `DRILL2.5`/`DRILL3` — the latter pair isn't even
a truncation, confirming these are two genuinely different SolidCAM
fields, not one field trimmed.

**Implementation.** `post.ts`, DefTool handler: the comment line uses
`params.tool_message ?? params.tool_id_string`.

---

## Comparison normalizations (what parity ignores)

The compare engine (`packages/core/src/lib/post-test.ts`) treats these as
equal unless `--strict`:

- **Trailing whitespace.** Legacy output has trailing spaces on most
  lines; generated output does not. Lines are `trimEnd()`ed.
- **Post date comments.** `N.. ; Date : ...` lines are normalized.
- **N-numbers (opt-in).** `--ignore-numbering` / `ignoreLineNumbers`
  strips `N\d+` prefixes. Every `different` result also carries
  `numberingDriftOnly`, shown as `different (numbering)` in the table —
  if you see that, hunt for one added/removed block upstream, not a
  content bug in the flagged file.

---

## Known open gaps

### `siemens-828d-ag-big-sabet-cam-milling`: 35/37 matched

Two unresolved differences, tracked in the parity baseline rather than
hidden:

- **`iRough_faces_3.SPF`, 2 lines** — a `Line` event immediately after a
  mid-job `m_feed_spin` (spindle speed change within a running job, not
  at job start) drops its feed word (`F753`) even though legacy repeats
  it. Forcing feed output unconditionally after every `MFeedSpin` was
  tried and **reverted** — it regressed 2541021, 567, and 26646, so the
  real rule is conditional on something not yet identified (likely tied
  to why the spindle changed mid-job — a rotary-pattern restart is the
  suspect, unconfirmed).
- **`Tools_Length_Measurement.MPF` missing-reference** — the trace never
  references this filename at all, meaning the legacy posting run for
  this specific job had tool-measurement output toggled off, while
  Achar always emits it when `machineProfile.features.toolMeasurementProgram`
  is on. This looks like a **post-time toggle**, not a machine-identity
  constant — the same physical machine (PoyaKar 1160L 3A, shared with
  the passing `567` fixture) can apparently be posted with or without
  it. Achar's `MachineProfile` currently models this as a fixed machine
  property; representing it correctly would need a per-run override
  achar doesn't expose yet (`Siemens828dPostOptions.measureTools` exists
  on the post but isn't wired through fixture manifests or the CLI).

### Fixture files can ship the wrong machine data

This fixture's directory originally contained `Siemens_828D_Milling_4A.vmid`
and `.gpp` — but the trace's own `VMID_file:'PoyaKar_1160L_3A'` field said
otherwise, and the shipped VMID's `<Machine Name="...">` confirmed it was
actually the Siemens machine, not PoyaKar. The manifest now points
`vmid`/`machineProfile` at the `PROJECT_567_...` fixture's PoyaKar files
(same physical machine). **Always cross-check a new fixture's trace
`VMID_file` against the VMID file actually shipped with it** before
trusting parity results — a mismatched VMID produces validation errors
and, more dangerously, silently wrong parity if the wrong machine
profile happens to still generate valid-looking G-code.

---

## Debugging a parity failure

1. `bun run achar test <fixture>` — get the failing file list. Files
   `different` at line 1 with `(numbering)` are cascade, not cause; find
   the first file with a real content diff.
2. `bun run achar explain <fixture> --file <name>.SPF` — maps every
   emitted block to the trace event and handler that produced it.
3. Dump the suspect event's parsed fields (values + `__changed` flags)
   with a small script using `Parser`; the flags usually explain the
   discrepancy.
4. When the root cause is a new legacy behavior: gate it correctly
   (job type / tool change / transform flags / machine-profile feature),
   verify **all** fixtures still pass, then record the rule here with its
   evidence.

Rules 1–4 and 6 above were found with exactly this loop (session of 2026-07-11,
commit `122be8e`), including two false starts that broke passing fixtures
— which is why step 4 says all fixtures, not just the failing one.
