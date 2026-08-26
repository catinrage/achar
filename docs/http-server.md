# Achar HTTP server

One process serves two surfaces:

- **`/v1/*` — the stateless API.** Every request carries its own inputs and
  receives its results in the response body: no workspace root, no server-side
  file paths, no writes to disk, nothing retained between requests. This is
  what another application consumes, and what the rest of this document covers.
- **`/` and `/api/*` — the workshop UI.** A browser front end where several
  people share one job queue, served by `workshop/` in the same package,
  mounting its routes on the same kernel. It is stateful by necessity; see
  [workshop-ui.md](workshop-ui.md). Nothing it does reaches `/v1`: no handler
  there can import the workshop, which is enforced as a boundary rule in
  [.fallowrc.json](../.fallowrc.json) and checked by `fallow dead-code`.

Both are the difference from the MCP server, which runs locally over stdio and
is therefore path-based.

Achar returns raw machining facts and G-code. It knows nothing about any
consumer: material and fixture names come back as the verbatim SolidCAM
strings, and mapping them onto your own vocabulary is your job.

**No trace is parsed on the HTTP thread.** `Parser.parse()` is synchronous and
holds the loop for ten to fifteen seconds on a 311 MB file, so every
trace-reading route dispatches to a worker thread. `/health` answers in under a
millisecond while a parse is in flight.

## Starting it

```bash
bun run achar:serve
```

```bash
bun run achar serve --port 7788 --host 127.0.0.1 --token "$ACHAR_SERVER_TOKEN"
```

| Flag | Env fallback | Default | Meaning |
|---|---|---|---|
| `--port <number>` | `ACHAR_SERVER_PORT` | `7788` | Port to listen on |
| `--host <host>` | `ACHAR_SERVER_HOST` | `127.0.0.1` | Interface to bind |
| `--token <token>` | `ACHAR_SERVER_TOKEN` | none | Bearer token for `/v1/*` |
| `--max-body <mb>` | — | `384` | Maximum trace upload, megabytes |
| `--max-parses <n>` | — | `1` | Concurrent trace parses |
| `--data-dir <path>` | `ACHAR_DATA_DIR` | `./.achar-data` | Volume for the job queue (workshop only) |
| `--web-root <path>` | `ACHAR_WEB_ROOT` | bundled build | Built web UI to serve |
| `--retention-days <n>` | — | `14` | Days an uploaded trace is kept |
| `--logs` | — | off | Allow the parser's own logging |

Flags win over environment variables.

The host defaults to loopback deliberately — binding publicly must be a
conscious act. There is no CORS: `/v1` is a server-to-server API, and the UI is
served from the same origin as the `/api` routes it calls.

### Authentication

With `--token` set, every `/v1/*` route requires `Authorization: Bearer <token>`,
compared as a SHA-256 digest so neither the comparison nor the token length
leaks through timing. `/health` never requires a token, so a supervisor can
probe a protected server.

**With no token configured, every `/v1` route is open.** In that mode the port
must not be reachable from an untrusted network.

The token guards `/v1` only. The workshop UI and its `/api` routes are
deliberately unauthenticated — there is no login for a browser to present — so
a deployment that exposes this port is trusting everyone who can reach it. See
[workshop-ui.md](workshop-ui.md#trust-boundary).

## Request shapes

Every trace-consuming endpoint accepts two shapes.

**A. Raw body** — `Content-Type: text/plain`, `application/octet-stream`, or
absent. The entire body is the endpoint's primary document and all options come
from the query string. This is the fast path.

**B. Multipart** — `multipart/form-data` with named parts:

| Part | Purpose |
|---|---|
| `trace` | The Trace 5 `.MPF` (required by trace endpoints) |
| `vmid` | Optional VMID |
| `machineProfile` | Optional machine profile JSON |
| `reference` | Repeatable; reference NC files for parity |
| `post` | Post source, for `/v1/post/lint` |

Non-file text fields carry the same options as the query string. **The query
string wins on conflict**, so a caller can override a stored form field without
rebuilding the body.

Shared options: `programName` (defaults to the trace's own `part_name`, then
`PROGRAM`) and `postId` (defaults to `siemens-828d`).

## Endpoints

### `GET /health`

```bash
curl -s localhost:7788/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 7,
  "parsing": 1,
  "queued": 3
}
```

`parsing` and `queued` report the worker pool. They let a supervisor tell
"healthy but saturated" from "healthy and idle" without reading the access log,
and both stay answerable during a parse, because no parse runs on this thread.

### `GET /v1/posts`

```bash
curl -s localhost:7788/v1/posts
```

```json
{
  "posts": [
    { "id": "siemens-828d", "name": "Siemens 828D Milling 4A", "aliases": ["default"] }
  ]
}
```

### `POST /v1/trace/profile`

The whole-part summary: part metadata, per-setup and per-tool machining time,
the tool catalog, and diagnostics. This is the endpoint an ERP wants.

```bash
curl -s --data-binary @2541021_CAM_Milling.MPF \
  -H 'Content-Type: text/plain' \
  localhost:7788/v1/trace/profile
```

```jsonc
{
  "part": {
    "name": "2541021_CAM_MILLING",
    "modelName": "F:\\General\\...\\2541021_CAM.SLDASM",
    "programNumber": 1000,
    "materialName": "Aluminum_120BHN-69HRB",   // verbatim SolidCAM string
    "inchSystem": false,
    "stockType": 0,
    "stock":  { "x": 357.643, "y": 36.327, "z": 337.887 },
    "target": { "x": 239.618, "y": 240.253, "z": 329 }
  },
  "setups": [
    {
      "name": "Setup1",
      "fixtureName": "Fixture",                // verbatim SolidCAM string
      "partHomeNumber": 1,
      "seconds": 794,
      "duration": "0:13:14",
      "tools": [
        { "tool": "END12Z3AL", "seconds": 224, "duration": "0:03:44", "jobInstances": 1 }
      ],
      "jobs": [
        { "name": "iRough-Outside", "tool": "END12Z3AL", "instances": 1,
          "seconds": 224, "cuttingSeconds": 180, "linkingSeconds": 30,
          "duration": "0:03:44" }
      ]
    }
  ],
  "tools": [
    { "toolIdString": "END12Z3AL", "name": "EM12", "type": "end mill",
      "diameter": 12, "teethCount": 3, "declaredWorkTime": "0:03:44",
      "seconds": 224, "duration": "0:03:44", "jobInstances": 1 }
  ],
  "totals": { "seconds": 4725, "duration": "1:18:45" },
  "eventCount": 195387,
  "diagnostics": []
}
```

The parsed event array is never included — a 67 MB trace yields 228,406 events.

### `POST /v1/trace/timing`

`TimingReport` only: totals, per-setup, per-tool. A subset of `profile`.

```bash
curl -s --data-binary @trace.MPF -H 'Content-Type: text/plain' \
  localhost:7788/v1/trace/timing
```

### `POST /v1/trace/validate`

```bash
curl -s -F trace=@trace.MPF -F vmid=@machine.vmid \
  -F machineProfile=@machine.machine.json \
  localhost:7788/v1/trace/validate
```

```json
{ "eventCount": 195387, "durationMs": 2140.3, "diagnostics": [] }
```

### `POST /v1/trace/generate`

Returns G-code inline. Measured: a 58 MB trace produces 38 files totalling
1.55 MB of NC code, which is comfortable in a JSON body. Nothing is written to
disk.

```bash
curl -s --data-binary @2541021_CAM_Milling.MPF \
  -H 'Content-Type: text/plain' \
  'localhost:7788/v1/trace/generate?programName=2541021_CAM_Milling'
```

```jsonc
{
  "files": [
    { "file": "2541021_CAM_Milling.MPF", "code": "N10 ; COMPENSATION-WEAR\n...",
      "bytes": 2892, "lines": 113 },
    { "file": "iRough_Outside.SPF", "code": "...", "bytes": 226539, "lines": 6268 }
  ],
  "eventCount": 195387,
  "durationMs": 2210.7,
  "diagnostics": []
}
```

If any diagnostic has `severity: "error"`, nothing is generated: the response is
`422` and carries `eventCount`, `durationMs`, and `diagnostics` — **no `files`
key at all**, so an empty result can never be mistaken for a successful one.

### `POST /v1/trace/explain`

Returns `text/plain`, not JSON. `file` and `event` narrow the output.

```bash
curl -s --data-binary @trace.MPF -H 'Content-Type: text/plain' \
  'localhost:7788/v1/trace/explain?file=iRough.SPF'
```

### `POST /v1/trace/parity`

Compares freshly generated output against reference NC files you upload.
Requires at least one `reference` part.

```bash
curl -s -F trace=@trace.MPF -F programName=2541021_CAM_Milling \
  -F reference=@reference/2541021_CAM_Milling.MPF \
  -F reference=@reference/iRough_Outside.SPF \
  localhost:7788/v1/trace/parity
```

```json
{
  "results": [{ "file": "2541021_CAM_Milling.MPF", "status": "match" }],
  "summary": { "match": 2, "different": 0, "missingGenerated": 0, "missingReference": 0 }
}
```

Unlike the CLI, `allReferenceFiles` defaults to **true** here: every part you
upload was chosen deliberately, whereas a reference *directory* also holds
unrelated files. Also accepts `ignoreLineNumbers`, `strict`,
`normalizeTimestamps`, and `maxDiffsPerFile`.

### `POST /v1/trace/parse`

Raw events, **always paginated**. One trace can hold 228,406 events; returning
them in one response would bury both this server and the caller.

| Option | Default | Limit |
|---|---|---|
| `limit` | 500 | clamped to 5000 |
| `offset` | 0 | — |
| `event` | none | exact `_eventName` filter |

```bash
curl -s --data-binary @trace.MPF -H 'Content-Type: text/plain' \
  'localhost:7788/v1/trace/parse?limit=3&offset=5'
```

```json
{
  "events": [{ "_eventName": "UsrSofComments", "_index": 5, "_depth": 2 }],
  "total": 47987, "offset": 5, "limit": 3
}
```

An over-max `limit` is clamped rather than rejected; `total` always reflects the
full filtered set so you can page through it.

### `POST /v1/vmid/parse`

```bash
curl -s --data-binary @machine.vmid -H 'Content-Type: text/plain' \
  localhost:7788/v1/vmid/parse
```

```json
{ "vmid": { "machine": { "Name": "..." }, "axes": [], "parameters": [] },
  "summary": "PoyaKar_1160L_3A: 42 user parameters, axes X, Y, Z" }
```

### `POST /v1/post/lint`

```bash
curl -s --data-binary @post.ts -H 'Content-Type: text/plain' \
  'localhost:7788/v1/post/lint?driverFile=false'
```

```json
{ "issues": [{ "rule": "no-raw-put", "line": 1,
  "message": "Use typed Builder helpers or a controller driver instead of $.put()." }] }
```

## Errors

Every error response is `{ "error": { "code": "...", "message": "..." } }`.
Branch on `code`; it is stable. `message` is prose for a human and may change.
Messages never carry filesystem paths or stack traces.

| Status | `code` | When |
|---|---|---|
| 400 | `bad-request` | Malformed multipart, missing required part, bad option value, unknown `postId`, over-long line |
| 400 | `parse-failed` | The body could not be parsed as Trace 5, including a body containing no events at all |
| 401 | `unauthorized` | A token is configured and the request's is missing or wrong |
| 404 | `not-found` | Unknown route |
| 405 | `method-not-allowed` | Known route, wrong method; carries `Allow` |
| 413 | `body-too-large` | Over `maxBodyBytes` |
| 422 | *(no envelope)* | Valid input with error-severity diagnostics; the body is the full result, not an error |
| 422 | `unprocessable` | The trace parsed, but its content contradicts itself and no result could be produced |
| 503 | `busy` | Concurrency gate saturated; carries `Retry-After` |
| 500 | `internal` | Anything unexpected; message is deliberately generic |

The two `422`s differ in shape, so check for an `error` key before reading a
result. The diagnostics form returns the full result body anyway — the profile,
or `eventCount`/`durationMs`/`diagnostics` — so a caller can show an operator
what was extracted before the failure. The `unprocessable` form has no result
to return: something in the trace is self-contradictory, such as repeated
starts of one job name carrying different `job_time` stamps when they must
share one pattern total. Its message names the job.

**One caveat on 413.** Bun enforces its own transport-level body cap and answers
past it with an empty 413 before Achar sees the request. The server sets that
cap at twice `maxBodyBytes` so an ordinary overshoot still produces the JSON
body above; a body more than 2× the limit gets a bodyless 413. Always treat the
status as authoritative rather than requiring a parseable body on 413.

## Diagnostic codes

`/v1/trace/profile` reports diagnostics with a stable `code`. Branch on that,
never on the message.

| `code` | Severity | Meaning | What to do |
|---|---|---|---|
| `no-timing-data` | error | The trace carries no usable machining time: `totals.seconds` is 0, or every `tool_work_time` is empty/`0:00:00` | **Do not create production stages from this.** The part was posted without SolidCAM time estimation enabled. Ask the operator to re-post with it turned on. |
| `no-setups` | warning | No `@setup` events; all machining is reported under one implicit setup named `(no setup)` | Usable, but you get one stage instead of several. Expect no `fixtureName` or `partHomeNumber`. |
| `empty-setup` | warning | One setup has zero machining time while others have time | Usually a setup that only repositions the part. Decide whether a zero-duration stage is meaningful to you. |
| `duplicate-setup-name` | warning | Two setups share a name | Do not key on setup name for this trace; use the array index. |

`no-timing-data` is real and common, not theoretical:
`fixtures/PROJECT_2551019_CAM_MILLING/` has `job_time: ''` on all 90 jobs and
`tool_work_time: '  0:00:00'` on every tool. Without this diagnostic a consumer
would read `0:00:00`, believe it, and create zero-duration production stages.

`/v1/trace/validate` and `/v1/trace/generate` additionally report VMID and
machine-profile findings, which use `severity` but not `code`.

## Limits, and the measurements behind them

Measured on this machine (Bun 1.3.14, WSL2, 20 cores) against a real
326,300,855-byte trace — 4,560,399 lines, 1,599,469 events — posted the way a
caller does, against the production image under `--memory=4g`.

| Stage | Wall clock | Container memory |
|---|---|---|
| Upload (streamed to disk) | 0.94 s | flat |
| Parse + generate + timing + profile | 22.4 s | 1.2 GB climbing to 3.2 GB |
| Immediately after the job finishes | — | **152 MB** |

That last row is the point of running parses in a worker process that exits
when it finishes. In a long-lived process the heap keeps its high-water mark:
six identical parses of this file took peak RSS from 1.5 GB to 5.2 GB with
nothing leaking, because JSC has no reason to shrink. A process per task hands
the memory back every time, and an out-of-memory kill takes the worker rather
than the server.

**Body size — default 384 MB.** Sized from what a worker can actually finish,
not from what the network can carry. The largest real trace seen is 311 MB and
peaks around 2 GB while parsing; a cap far above that would be a promise the
service cannot keep, since the request would be received in full and then die.
`Content-Length` is checked before the body is read, and a chunked upload that
declares no length is cut off at the same limit as it streams.

**Concurrency — default 1 parse.** Bounded by memory, not CPU. `/v1` routes
refuse with `503` plus `Retry-After` rather than queueing, which is what a
stateless API client is built to handle. Browser uploads queue instead, because
an operator who has already uploaded a file should be told they are third in
line. Raise `--max-parses` only against measured headroom on your own hardware.

**Line length — 8 KB, fixed.** A check on the shape of the input, not a
performance guard. The longest line in any of this repo's seven fixtures is 877
bytes, and the longest in the 311 MB trace above is 834 bytes, so a line past
8 KB is not SolidCAM Trace 5 output; traces containing one are rejected
`400 bad-request`.

This cap used to be the only thing bounding a denial of service. The parser's
key-value regex backtracked quadratically on a long run of word characters
containing no `:`, so a single crafted line could occupy the parse worker for
seconds — and with the default of one concurrent parse, that is the whole
service. The pattern is anchored now, and the cost is linear:

| Single line | Before | After |
|---|---|---|
| 8 KB | 105 ms | 0.9 ms |
| 32 KB | 1.66 s | 0.2 ms |
| 64 KB | 6.59 s | 0.3 ms |
| 256 KB | — | 1.6 ms |

Measured through `Parser.parse()`; see `keyValuePattern` in
`packages/core/src/lib/parser.ts` for why the anchor matters and why it cannot
change which pairs are found.

## Running under systemd

```ini
[Unit]
Description=Achar HTTP server
After=network.target

[Service]
Type=simple
User=achar
Group=achar
WorkingDirectory=/opt/achar
ExecStart=/usr/local/bin/bun run achar serve
Restart=on-failure
RestartSec=5

Environment=ACHAR_SERVER_HOST=127.0.0.1
Environment=ACHAR_SERVER_PORT=7788
# Prefer a credential file over an inline secret.
EnvironmentFile=/etc/achar/server.env

# A worker holds a whole trace plus its parsed events while it runs, then
# exits. Size this for one trace's peak — roughly 2 GB for a 311 MB file —
# not for the running total of everything parsed since boot.
MemoryMax=4G

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
# The code is read-only; the job queue's volume is the only writable path.
ReadOnlyPaths=/opt/achar
ReadWritePaths=/var/lib/achar
Environment=ACHAR_DATA_DIR=/var/lib/achar

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`/etc/achar/server.env`, mode `0600`:

```
ACHAR_SERVER_TOKEN=<a long random string>
```

`SIGTERM` stops the listener and exits, so `systemctl stop` and `restart` are
clean.

### Request log

One line per request on stdout, captured by the journal:

```
POST /v1/trace/profile 200 req=58470410b res=1421b 2171.3ms
```

Method, path, status, request bytes, response bytes, duration.
