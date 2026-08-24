# Workshop UI

A browser front end so everyone in the workshop generates G-code from one
place, with one copy of each machine's configuration, instead of running their
own desktop install against their own `.vmid`.

It is served by the same process as the [`/v1` API](http-server.md) — one
container, one port, no separate web server. Open `http://<host>:7788/`.

```
packages/server      packages/workshop            packages/web
  /v1 · kernel   <—    /api · queue · SQLite   <—   the UI
  parse workers        machines · retention        (static build)
  stateless            stateful

achar container
├── GET  /                     web UI (static Svelte 5, Farsi/RTL)
├──      /api/*                the UI's own API — queue, jobs, machines
└── POST /v1/trace/*           the stateless API, unchanged
        ↑
   both dispatch every parse to the same worker pool
```

The split is deliberate. `@achar/server` owns the HTTP kernel, the `/v1` table
and the worker pool, and keeps its promise that nothing survives a request — no
database, no volume. `@achar/workshop` builds this service on that kernel and
is stateful by necessity. Everything below belongs to the second package; `/v1`
is unaffected by any of it.

## Why it exists

A post-processor is only reproducible if its configuration is. When each
machinist has a private copy of a VMID and a machine profile, the same trace
posted by two people can produce different G-code, and nothing on the shop floor
says which one is right. Here the machine definitions live once, on the server,
and the operator picks one by name.

Uploading the same trace against the same machine twice does not re-run
anything: the trace is hashed on arrival, and a repeat returns the earlier job.
The result is not merely equivalent, it is the same bytes.

## The flow

1. **Drop a Trace 5 `.MPF`** on the page, or click to pick one.
2. **Choose the machine.** The dropdown is the whole configuration choice —
   post, VMID and machine profile all come with it.
3. **Optionally name the program.** Left empty, the trace's own `part_name` is
   used, then `PROGRAM`.
4. **Generate.** The upload streams to the server with a progress bar, then the
   job queues. If someone else is ahead you are told your place in line.
5. **Results**, in three tabs from the same parse:
   - **G-code** — every generated file with size and line count, viewable in the
     browser, downloadable one at a time or as a ZIP.
   - **Cycle time** — total, per setup, and per job with its tool.
   - **Tools** — the tool list, longest-running first, which is the order a
     setter cares about.

**History** lists recent jobs and reopens any of them. **Machines** is where an
admin adds or retires a machine.

### When a trace cannot be posted

Some traces parse but carry error-severity diagnostics — most often
`no-timing-data`, meaning SolidCAM was re-posted without time estimation. Those
jobs finish as *blocked*: no G-code, but the diagnostics say why, and cycle time
and the tool list are still shown. A blocked job is recorded in history like any
other, so the reason is still there tomorrow.

## Machines

A machine is a name, a post id, and optionally a VMID and a machine profile.
Both companion files are parsed when the machine is created, not when a trace is
first posted against it, so a wrong file fails while an admin is looking at the
form.

Uploading arbitrary text as a VMID is caught: the core parser is lenient and
returns an empty definition rather than an error, so a definition with no axes
and no parameters is treated as the wrong file.

Deleting a machine removes its files. Jobs keep their machine id, so history
still records what a program was posted for after the machine is retired.

## Storage and retention

Everything lives under `--data-dir` (`ACHAR_DATA_DIR`, `/var/lib/achar` in the
container):

```
/var/lib/achar/
├── achar.sqlite          job rows, machine rows, generated-file index
├── machines/<id>/        machine.vmid, machine.json
├── jobs/<id>/
│   ├── trace.MPF         the upload, streamed here as it arrived
│   └── out/*.SPF         generated output
└── spool/                scratch for /v1 request bodies
```

An upload is written to disk as it arrives rather than buffered, so a queued
trace costs disk instead of competing for the memory the parse ahead of it is
already using.

**Traces expire, output does not.** A 311 MB trace produces a few hundred
kilobytes of G-code — roughly 1000:1 — so keeping every result costs nothing
while keeping every input would fill the volume within weeks. Uploaded traces
are deleted after `--retention-days` (default 14); job rows and generated files
stay indefinitely. A purged job no longer serves a cache hit, since it can no
longer be re-run or verified.

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

Do not publish this port beyond the workshop. The parser also has a known
quadratic case on very long lines — bounded by an 8 KB line cap, not cured by it
— which is a second reason the same limit applies. If this ever needs to be
reachable more widely, that is a decision to revisit, not a header to add.

## Restarts

Job state survives a restart. A job left `running` when the process stopped is
re-queued, because a job is a pure function of its trace and machine and
re-running produces the same output. Machines, history, generated files and the
content hash cache all come back from the volume.

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
