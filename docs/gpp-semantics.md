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

The distinction matters for the A word (rule 5) but **not** for what
happens to the output file: every repeat rewrites it (rule 4).

### File directives

A trace carries the legacy post's own file operations, as output lines:

```
> !! delete file = D_drill4.SPF !!
> !! open file = D_drill4.SPF !!
> !! close file = D_drill4.SPF !!
```

A `delete` immediately before an `open` means that open starts from empty.
These are the one part of a trace's `>` lines achar reads: they describe what
legacy did with *files*, not what it emitted, so using them checks structure
without handing the post its own answer. `readTraceFileLifecycle` in
`lib/post-test.ts` parses them and `achar test` compares them against the
post's own opens — see rule 4.

In both cases the `job_time` / `job_cutting_time` / `job_linking_time` stamps
carry the total for the whole pattern, repeated verbatim on every instance —
not the time of one instance. `lib/timing.ts` therefore counts a repeated job
name once; see the `timing` command in [cli-guide.md](cli-guide.md).

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
`runtime.ts` exposes it as `changedOrDifferent`; use that rather than a bare
`sameNumber` in any new position guard. `drilling.ts` `DrillPoint` was the
last site still comparing numerically, which showed up as a stray `Y0`
against a `Y0.00001` approach — flagged `F`, so legacy printed nothing.

### Rule 4 — A repeated job rewrites its subprogram from empty

**Statement.** When a job with the same file name starts again — rotary
pattern, translate pattern or plain re-post — the new instance **replaces**
the file's content. Only the last write survives on disk. The discarded
writes still consume their N-numbers: numbering is a single global monotonic
counter, so the final file starts at whatever N the *last* write began at,
and there is a hole in the global sequence where the discarded content was.

`used_in_transform_4x` does not enter into it. The GPP condition is on
`used_in_transform_translate or used_in_transform_4x`, which is every repeat
this project has seen.

**Why it matters more than a normal parity rule.** Appending instead
produces a file holding one body per repeat, each ending in `RET`. `EXTCALL`
returns at the first `RET`, so all N calls run body one and every rotary
position is cut at the first angle. The file looks plausible and the machine
scraps the part.

**Evidence.**
- Replace: `fixtures/PROJECT_434.../reference/HSS_PC_Lin_faces2.SPF` starts
  at `N74680`; N1960–N74670 exist in **no** reference file — burned by the
  discarded first write. The MPF still EXTCALLs the file twice.
- Rotary: `PROJECT_B0577` `D_drill4.SPF` is one 17-line body called 8 times,
  written 8 times (trace `!! delete file !!` before each open), numbered from
  the eighth write's position in the global sequence.

**GPP history — read this before trusting an old fixture.** Until 2026-07 the
condition was `used_in_transform_translate` alone, so a rotary pattern
appended. `PROJECT_2541021`'s original reference was posted that way:
`iRough_faces.SPF` held 8 bodies with 8 `RET`s and the MPF called it 8 times,
i.e. legacy emitted a program that cut all 8 positions at A22. The fixture
was re-posted 2026-08-30 with the corrected GPP. If a fixture reference ever
shows stacked bodies again, it was cut with the old post — re-post it rather
than teaching achar to reproduce it.

**Implementation.** `job-lifecycle.ts` `openJobFile`: unconditional
`OpenFile(jobFile, 'SPF', 'replace')`. The Builder's global line counter
provides the burned-numbers behaviour for free. `achar test` additionally
checks the post's opens against the trace's file directives and reports a
mismatch ahead of the line diff, because this failure cascades into every
downstream N-number and the diff alone points nowhere useful.

### Rule 5 — 4x-transform jobs keep the A-word out of the subprogram

**Statement.** For `used_in_transform_4x` jobs the rotary position belongs to
the **caller**: the main file emits `A<anext>` immediately before each
`EXTCALL`, and the subprogram body carries no A word at all — job-start
block, approach, or drill point. It has to be absent, because one body is
shared by every angle (rule 4).

That caller-side A is emitted **unconditionally**. Legacy writes
`{nb, 'A'anext}` with no modal check, so the word is restated before every
call even when the axis is already there. Guarding it on the last emitted A
drops it exactly when the body has already moved the axis, which is every
instance of a rotary drill pattern.

Non-transform jobs with a rotary axis do emit A inside the SPF (job-start
block, and approach repeats per rule 1).

**Evidence.** GPP `@end_of_job` (~line 1592):

```gpp
if used_in_transform_4x
  {nb, 'A'anext}
endif
{nb, 'EXTCALL "'parsed_name'.SPF"'}
```

`PROJECT_B0577` main file: `A0 / EXTCALL / A-45 / EXTCALL / …` around a
`D_drill4.SPF` whose only motion line is a bare `G0`. Contrast
`Debur_target.SPF` in `PROJECT_434` (`X183 Y0 A61.915` inside the SPF), a
job with a rotary axis and no 4x transform.

Note `@fourth_axis` prints nothing for these jobs (`if used_in_transform_4x
eq 0`) while SolidCAM's own `apos` still advances — which is why legacy's
body sees "A unchanged" and prints a bare `G0`.

**Coverage caution.** Only `PROJECT_2541021` and `PROJECT_B0577` contain any
`used_in_transform_4x: 1` job; the other six fixtures have zero. Every 4x
branch in the post rests on those two. An earlier version of this rule cited
`4X_PC_faces1.SPF` in `PROJECT_434` as evidence — that is a
`job_type: '4x_parallel_cuts'` job, which is unrelated to the
`used_in_transform_4x` transform flag. Do not confuse the two.

**Implementation.** `job-lifecycle.ts`: `emitStartPosition`
(`!used_in_transform_4x` guard on the A word) and `restoreJobRotaryPosition`
(emits before `callSubprogram`, with no modal guard). `drilling.ts`
`DrillPoint` carries the same `!used_in_transform_4x` guard, as does Move5x
branch 1 in `post.ts`.

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

**Statement.** The `drillApproachZBeforeCoolant` repeat (a dialect trait;
rule from the
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

**Statement.** On machines with the `tapCycleOptionalStop` machine feature, every
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

**Implementation.** `MachineProfileFeatures.tapCycleOptionalStop`
(`machine-profile.ts`); `drilling.ts` DrillPoint handler emits
`$.OptionalStop()` before the cycle call when the feature is on and
`drill_cycle_name === 'CYCLE84'`. Enabled on `PoyaKar_1160L_3A.machine.json`.
This stayed a *machine* property after the dialect split: the evidence above
is that the same GPP omits it elsewhere, so it tracks the machine rather than
the output convention.

### Rule 10 — The tool-list comment uses SolidCAM's short tool name, not the selection id

**Statement.** The `; T<number>-<name>` lines in the "Tools Used In This
Program" comment block (main-file, `mainToolListComments` dialect trait) use
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

### Rule 11 — Line-feed output: two GPPs, two rules (machine-gated)

**Statement.** Whether a linear move re-prints an unchanged `F` word
depends on which legacy GPP posted the job — the two posts have
genuinely different `@usr_line` source:

- **PoyaKar_1160L_3A.gpp** prints `['F'feed ' ']` from GPP's raw
  `change(feed)` bit. Since `feed` is a single global variable shared by
  every event that carries a `feed` parameter, an `m_feed_spin` mid-job
  can leave the bit set even when the value is numerically unchanged —
  and the next line prints `F` anyway. The trace's `feed__changed` flag
  **is** that bit, so achar trusts it on these machines.
- **Siemens_828D_Milling_4A.gpp** explicitly overrides the bit with its
  own comparison (`if feed ne prevFeed → change(feed)=true else false`),
  so only a numeric change against the previous *line* feed prints `F`.

Both share the `bFeedoutput` one-shot: every non-synchronized rapid sets
it, forcing the next line/arc to print `F` once regardless
(achar's `state.forceFeedOutput`).

**Evidence.** `PoyaKar_1160L_3A.gpp` `@usr_line` (~line 1616): no
`prevFeed`, plain conditional `['F'feed ' ']`.
`Siemens_828D_Milling_4A.gpp` `@usr_line` (~line 1764): the
`feed ne prevFeed` override plus `prevFeed = feed` after output.
Runtime confirmation: `fixtures/PROJECT_AG_BIG_SABET_CAM_Milling`
`iRough_faces_3.SPF` lines 714/809 — `Line` events with `feed=753`,
`feed__changed=true` right after an `m_feed_spin` (also `feed=753`),
where the reference prints `F753`; enabling the flag globally regressed
2541021/26646 (Siemens-GPP fixtures), matching the source difference
exactly.

**Implementation.** `Siemens828dDialect.lineFeedFromChangeFlag`
(`posts/siemens-828d/dialect.ts`, set on the `poyakar-1160l` dialect that
`PoyaKar_1160L_3A.machine.json` names); `post.ts` Line handler adds
`traceChanged(params, 'feed') === true` to `forceFeed` only when the trait is
on. This rule is the clearest case for the dialect split: the statement above
is literally "two GPPs, two rules", with no machine involved.

### Rule 12 — Coolant is modal for the whole program, cleared only by a tool-change block

**Statement.** `M8` is emitted when the coolant state *changes*, and the
state is program-global — not per job, not per file. It is cleared in exactly
one place during a program: the modal reset inside an emitted tool-change
block. That reset is **silent** — it assigns the variable without producing
`M9` — which is why a program has roughly one `M8` per tool change and only a
single `M9`, at the end.

Two consequences that are easy to get wrong:

- A run of jobs sharing one tool emits `M8` once, on the first of them.
- What clears the state is *writing the tool-change block*, not the trace's
  `ChangeTool` event. A translate pattern re-emits one tool change for every
  instance off a single event, and each of those blocks resets modality.

**Evidence.** GPP `@usr_coolant_output` (~line 1290) gates every coolant
M-code on `change(iCoolantM<n>)`. `@usr_ct_init_gmstates` (~line 1134) sets
`iCoolantM1 = iCoolantM1OFF` in both branches without calling
`@usr_coolant_output`. Note `bCoolofftc = false` in this GPP, so the
*explicit* between-tools coolant-off at ~line 871 never runs — the modal
reset is doing all the work. Reference counts: `M8` 15 / `M9` 1 in
`PROJECT_B0577` against 14 tool changes; `M8` 16 / `M9` 1 in `PROJECT_434`.
`D_drill3.SPF` in B0577 has no `M8` (same `DRILL2.5C` as the preceding
`D_drill.SPF`, which does); `D_drill1_1.SPF` in 434 does, because its
surviving write re-emits the tool change.

**Not a dialect.** An earlier `retainCoolantAcrossJobs` dialect trait made
this machine-dependent. It cannot be: all fixtures share one byte-identical
GPP, and `change()` is unconditional GPP logic. The trait is removed; the key
stays in `DIALECT_FEATURE_KEYS` so an old profile naming it gets a targeted
error.

**Implementation.** `drilling.ts` Drill handler gates on `state.coolantActive`
alone; `job-lifecycle.ts` `emitToolChange` clears it as the block is written.

### Rule 13 — A zero tool-change park coordinate means "unset"

**Statement.** A job's `nTC_XSUPA` / `nTC_YSUPA` carry the tool-change park
position, and legacy reads a **zero as "not set"**, substituting its own pair
— X `-465`, Y `140` — before emitting anything. The substitution happens once
at the top of the tool-change handler, so both the park move and the `iM1`
operator-prompt block read the resolved values.

This pair is its own constant, distinct from `GPX_XHOME`/`GPX_YHOME`
(`-465`/`190`, the machine home) and `GPX_XHOMEND`/`GPX_YHOMEND`
(`260`/`190`, the program-end park). It coincides with home in X only, which
is exactly what makes reusing home look correct until a job leaves Y at zero.

**Evidence.** GPP `@usr_ct_toolchange` (~line 918):

```gpp
if nTC_YSUPA eq 0
  nTC_YSUPA = 140
endif
if nTC_XSUPA eq 0
  nTC_XSUPA = -465.000
endif
```

`PROJECT_B0577` has two jobs at `iTC_SUPA_MODE : 3` with
`nTC_XSUPA : -465, nTC_YSUPA : 0`; the reference emits
`G0 SUPA X-465 Y140` in `F_contour.SPF` and `F_contour2.SPF`. Only
`iTC_SUPA_MODE` other than 0 reaches this path, and only 2541021 (Y `50`,
non-zero) and B0577 have such jobs at all — which is why the missing
substitution went unseen.

**Implementation.** `machine.ts` `toolChangePark` (a post constant with an
override hook, not a `MachineProfile` field, because legacy hardcodes it);
`job-lifecycle.ts` `parkCoordinate` treats `0` and `undefined` alike. Note
`??` cannot express this — a job that names no park position carries `0`, not
nothing.

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

## Resolved gaps and reference-set caveats

### `siemens-828d-ag-big-sabet-cam-milling`: now 37/37

Two former gaps, both closed (2026-07-13):

- **`iRough_faces_3.SPF` missing `F753`** — root-caused by reading both
  GPP sources instead of guessing; see rule 11
  (`lineFeedFromChangeFlag`). The earlier blanket "force feed after
  every MFeedSpin" attempt failed precisely because the behavior is
  per-GPP, not per-event.
- **`Tools_Length_Measurement.MPF`** — the original posting run had
  tool-measurement output toggled off (a per-run SolidCAM option, not a
  machine property; the same PoyaKar machine's `567` fixture has the
  file). By decision, the reference copy in this fixture is
  **synthesized from achar's own output** rather than recorded from
  legacy, so parity treats it as covered. Caveat: for this fixture, that
  one file asserts self-consistency, not legacy parity — if the
  measurement-program format ever needs re-verification, use the `567`
  or `434` fixtures, whose copies are genuine legacy recordings.

### Fixture files can ship the wrong machine data

This fixture's directory originally contained `Siemens_828D_Milling_4A.vmid`
and `.gpp` — but the trace's own `VMID_file:'PoyaKar_1160L_3A'` field said
otherwise, and the shipped VMID's `<Machine Name="...">` confirmed it was
actually the Siemens machine, not PoyaKar. Confirmed (2026-07-13): the job
really was posted on the PoyaKar 3-axis machine, so the wrong files were
simply swapped for the correct `PoyaKar_1160L_3A.gpp`/`.vmid`/`.machine.json`
(copied from `PROJECT_567_...`, the other fixture on the same physical
machine) and the manifest points at its own local copies. The same caution applies to the `.gpp` copy. `PROJECT_B0577` shipped the
July GPP whose `!! delete file !!` condition contradicts its own trace,
which sent an investigation down the wrong path until the production copy
was compared (2026-08-30). The copies in `PROJECT_2541021` and
`PROJECT_B0577` are now the current post; the other fixtures still carry the
July one, which is correct — that is what posted them. A fixture's `.gpp` is
evidence, so it has to be the revision that produced the reference.

**Always
cross-check a new fixture's trace `VMID_file` against the VMID file
actually shipped with it** before trusting parity results — a mismatched
VMID produces validation errors and, more dangerously, silently wrong
parity if the wrong machine profile happens to still generate
valid-looking G-code.

---

## Debugging a parity failure

0. Read the file-lifecycle report if there is one. It prints above the diff
   table and names a structural mismatch against the trace's own
   `!! open / delete file !!` directives — a cause, where everything below it
   is cascade.
1. `bun run achar test <fixture>` — get the failing file list. Files
   `different` at line 1 with `(numbering)` are cascade, not cause; find
   the first file with a real content diff. A quick way to separate the two:
   compare with N-numbers, `\r` and trailing spaces stripped, and only the
   files that still differ have a real content diff.
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

Rules 12–13 and the rewrites of 4 and 5 came from `PROJECT_B0577`
(2026-08-30). That round added step 0 and one more habit worth keeping: when
a rule has exactly one witness, **read the GPP source before generalising
from it**. Rule 4 had been inferred from a single fixture and stated the
opposite of what the post's own `@start_of_job` says; the fixture it was
inferred from turned out to be legacy output from a since-fixed GPP bug.
