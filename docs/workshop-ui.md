# Workshop UI

A browser front end so everyone in the workshop generates G-code from one
place, with one copy of each machine's configuration, instead of everyone
running the tool locally against their own `.vmid`.

It is served by the same process as the [`/v1` API](http-server.md) — one
container, one port, no separate web server. Open `http://<host>:7788/`.

```
packages/server                                   packages/web
  kernel/    HTTP, parse workers            <—      the UI
  v1/        stateless API                          (static build)
  workshop/  /api · queue · SQLite · machines

achar container
├── GET  /                     web UI (static Svelte 5, Farsi/RTL)
├──      /api/*                the UI's own API — traces, jobs, machines
└── POST /v1/trace/*           the stateless API, unchanged
        ↑
   both dispatch every parse to the same worker pool
```

The split is deliberate, and it is now a directory boundary rather than a
package one. `kernel/` owns the HTTP layer and the worker pool. `v1/` is the
stateless API and keeps its promise that nothing survives a request — no
database, no volume. `workshop/` builds this service on the same kernel and is
stateful by necessity. Everything below belongs to `workshop/`; `/v1` is
unaffected by any of it.

`v1/` may not import `workshop/`. That used to be enforced by npm, when the two
were separate packages pointing one way; it is now a fallow boundary rule in
[.fallowrc.json](../.fallowrc.json), checked with `fallow dead-code`. The
enforcement changed, the guarantee did not.

`packages/web` stays its own package: it is a browser build with its own
toolchain, and keeping it separate is what lets the Dockerfile build the UI in
one stage and ship the runtime image without svelte in it.

## Why it exists

A post-processor is only reproducible if its configuration is. When each
machinist has a private copy of a VMID and a machine profile, the same trace
posted by two people can produce different G-code, and nothing on the shop floor
says which one is right. Here the machine definitions live once, on the server,
and the operator picks one by name.

Uploading the same trace twice does not re-read it, and generating the same
program twice does not re-run anything: the trace is hashed on arrival, a
repeat upload is answered from the stored analysis, and a repeat of the same
trace, machine, program name and setup selection returns the earlier job. The
result is not merely equivalent, it is the same bytes.

## The flow

Uploading and generating are two steps, because the question that decides what
gets generated — *which setups* — cannot be answered until something has read
the file.

1. **Drop a Trace 5 `.MPF`** on the page, or click to pick one. The upload
   streams to the server with a progress bar.
2. **The trace is analysed.** One pass yields the setup list, the cycle time
   and the tool list. None of that depends on a machine, so no machine has been
   chosen yet. The result is stored against the file's content hash and gets
   its own address — `/traces/<sha256>` — so it survives a reload and can be
   sent to a colleague.
3. **Choose the setups.** Every setup is listed with its fixture, its part home,
   how many jobs it runs and how long it takes, and all of them start ticked.
   See [Posting a subset of setups](#posting-a-subset-of-setups).
4. **Choose the machine.** The dropdown is the whole configuration choice —
   post, VMID and machine properties all come with it.
5. **Optionally name the program.** Left empty, the trace's own `part_name` is
   used, then `PROGRAM`.
6. **Generate.** The job queues; if someone else is ahead you are told your
   place in line.
7. **Results**, in three tabs from the same parse:
   - **G-code** — every generated file with size and line count, viewable in the
     browser, downloadable one at a time or as a ZIP.
   - **Cycle time** — total, per setup, and per job with its tool.
   - **Tools** — the tool list, longest-running first, which is the order a
     setter cares about.

Uploading the same file again costs one upload and no parse at all: the hash
matches, and the stored analysis is served immediately. Generating a second
selection from a trace already on the server costs nothing but the generate.

**History** lists recent jobs and reopens any of them; a job that covered only
some setups is labelled with which. **Machines** is where an admin adds or
retires a machine.

## When a trace cannot be posted

Some traces parse but carry error-severity diagnostics — most often
`no-timing-data`, meaning SolidCAM was re-posted without time estimation. Those
jobs finish as *blocked*: no G-code, but the diagnostics say why, and cycle time
and the tool list are still shown. A blocked job is recorded in history like any
other, so the reason is still there tomorrow.

`no-timing-data` belongs to the trace rather than to any machine, so it is
raised by the analysis and shown before a machine has been chosen — the
operator finds out from the upload, not from a job.

## Posting a subset of setups

A setup is one physical fixturing of the part, and the operator runs one at a
time. Posting all ten of them to run three is a program full of jobs the
machinist must not run.

The picker addresses setups by **index** — the number in the first column.
SolidCAM does not guarantee `setup_name` is unique, so the index is the
reliable address, and it is the same number `achar generate --setups` takes.

Three things worth knowing, all of which the UI says at the point they apply:

- **A subset is a new program, not a slice of the old one.** The post is a
  modal state machine, so a setup posted without the one before it starts from
  program defaults rather than the state its predecessor left behind — most
  consequentially the cutting tolerance. The job carries a warning naming the
  setup and what to check.
- **Tool definitions are pruned.** `DefTool` events for tools no selected setup
  loads are dropped, so the tool-list comment and `Tools_Length_Measurement.MPF`
  describe the run the operator is about to make. Tool numbers ride on each
  event and are never renumbered, so the survivors keep their identity. Tick
  **نگه‌داشتن جدول کامل ابزارها** to keep the whole table.
- **The filenames are the same ones a full run writes.** Two of these in one
  folder overwrite each other, which is why a partial program is labelled as
  one in the results, in history, and nowhere else.

Selecting every setup is stored as "the whole part" rather than as a list, so
ticking all the boxes and ticking none produce the same job — and the same
bytes as before this feature existed. A trace with no `@setup` events at all
posts as one program and the picker does not appear. Jobs that run before the
first `@setup` belong to the shared prologue and are posted with every
selection; the UI says so when a trace has any.

## Machines

A machine is a **record**, not a folder of files: a name, a post, its
properties, and optionally a VMID.

Everything about the machine is a form field — the dialect, the axis count,
the home and return positions, and each declared property. The VMID is the one
thing still uploaded, because a `.vmid` is an artefact the machine builder
produced and nobody authors one by hand. That is the whole storage rule: what
this application owns lives in the database, what it merely received lives on
the volume.

The property inputs are rendered from the feature schema served by
`GET /api/posts`, so a property added to the core table reaches the UI with the
row that declares it. Boolean properties are **three-way** — default, yes, no —
because "says nothing" and "says no" are different answers: a machine with no
tool probe has to be able to turn the measurement program off, which a checkbox
cannot express. A machine that declares `maxSpindleSpeed` blocks any job
commanding more, with the speed named in the diagnostics. The **نمایش JSON**
disclosure shows exactly what will be stored, for reading rather than editing.

The `id` and `name` in the stored document are the machine's own, imposed on
save. `extends` names machines by id, so a profile carrying somebody else's id
would be a trap nobody could see from a form — and there is no reason to ask
for something the record already knows. The `controller` is not asked for
either: it belongs to the post, which already declares it.

Everything is validated at the point of definition rather than on first use,
through the same function that gates generation — so what an admin sees when
saving a machine is what a machinist would have hit when posting: a dialect the
post cannot speak, a home position outside the VMID's travel. Changing a
machine's post or VMID re-checks a profile nobody touched, since either can
invalidate it.

A machine can be built on another — `extends`, chosen from a dropdown of the
other machines — stating only what differs: "like the PoyaKar, but four-axis".
The shared values then have one home, the one everybody already edits, so
correcting a base corrects every machine built on it. A machine cannot extend
itself, and one that others are built on cannot be deleted until they are
pointed elsewhere. Jobs receive the profile already flattened, because the
worker that posts a trace cannot reach the other machines.

A form where every property is left blank stores no profile at all: a document
carrying only an id and a name is an empty form, not a configuration.

Uploading arbitrary text as a VMID is caught: the core parser is lenient and
returns an empty definition rather than an error, so a definition with no axes
and no parameters is treated as the wrong file.

Deleting a machine removes its record and its VMID. Jobs keep their machine id,
so history still records what a program was posted for after the machine is
retired.

Machines defined before this layout — a `machines/<id>/machine.json` on the
volume — are moved into the database at startup, once, and the file is deleted
only after its content is safely in the column.

## Storage and retention

Everything lives under `--data-dir` (`ACHAR_DATA_DIR`, `/var/lib/achar` in the
container):

```
/var/lib/achar/
├── achar.sqlite          job rows, machine records, trace analyses
├── machines/<id>/        machine.vmid
├── traces/<sha256>/
│   └── trace.MPF         the upload, streamed here as it arrived
├── jobs/<id>/out/*.SPF   generated output
└── spool/                scratch for /v1 request bodies
```

An upload is written to disk as it arrives rather than buffered, so a queued
trace costs disk instead of competing for the memory the parse ahead of it is
already using.

**Uploads are content-addressed.** The same file posted for a second machine,
or for a different set of setups, is stored and parsed once. A repeat upload is
recognised by its hash and answered from the stored analysis.

**Traces expire, output does not.** A 311 MB trace produces a few hundred
kilobytes of G-code — roughly 1000:1 — so keeping every result costs nothing
while keeping every input would fill the volume within weeks. Uploaded traces
are deleted after `--retention-days` (default 14), counted from the last time
anyone uploaded that file; job rows, generated files and the *analysis* stay
indefinitely, because what was in a file is still worth reading once the bytes
are gone. A purged trace no longer serves a cache hit, since it can no longer
be re-run or verified. A trace a queued job still needs is never swept.

Back up the volume. Generated G-code is reproducible from a trace, but the
machine definitions are not.

## Trust boundary

**There is no login.** This is a deliberate choice for a workshop LAN: `/api`
and the UI are open to anyone who can reach the port, and job history is
anonymous. `/v1` still requires its bearer token, because that is a
server-to-server contract with a different consumer.

Consequences to be clear about:

- Anyone on the network can submit work, and one 300 MB parse occupies the
  single worker slot for the better part of a minute.
- Anyone on the network can read every job's output.
- Nothing records *who* generated a program.

Do not publish this port beyond the workshop. If this ever needs to be
reachable more widely, that is a decision to revisit, not a header to add.

## Restarts

Job state survives a restart. A job left `running` when the process stopped is
re-queued, because a job is a pure function of its trace, its machine and its
setup selection, and re-running produces the same output. An upload left
mid-analysis is re-analysed, for the same reason. Machines, history, generated
files, stored analyses and the content-hash cache all come back from the
volume.

## Developing the UI

```bash
bun run --cwd packages/web build      # once
bun run --cwd packages/web dev        # rebuild on change
bun run achar serve --port 7788       # serves packages/web/dist
```

There is no separate dev server: the API and the page share an origin in
production, and a second origin in development would only invent CORS problems
that do not exist in the deployment.

Strings live in `packages/web/src/messages/fa.ts`. Diagnostics from
`@achar/core` are shown verbatim in English — they name trace events, axes and
VMID parameters exactly as written, so translating them would make them harder
to match against the file, not easier.
