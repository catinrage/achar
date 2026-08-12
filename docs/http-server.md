# Achar HTTP server

A stateless HTTP front end for `@achar/core`. Every request carries its own
inputs and receives its results in the response body: no workspace root, no
server-side file paths, no writes to disk, nothing retained between requests.

This is the difference from the MCP server, which runs locally over stdio and
is therefore path-based. Use the HTTP server when another application needs
Achar as a service.

Achar returns raw machining facts and G-code. It knows nothing about any
consumer: material and fixture names come back as the verbatim SolidCAM
strings, and mapping them onto your own vocabulary is your job.

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
| `--max-body <mb>` | — | `128` | Maximum request body, megabytes |
| `--max-parses <n>` | — | `1` | Concurrent trace parses |
| `--logs` | — | off | Allow the parser's own logging |

Flags win over environment variables.

The host defaults to loopback deliberately — binding publicly must be a
conscious act. There is no CORS: this is a server-to-server API.

### Authentication

With `--token` set, every `/v1/*` route requires `Authorization: Bearer <token>`,
compared as a SHA-256 digest so neither the comparison nor the token length
leaks through timing. `/health` never requires a token, so a supervisor can
probe a protected server.

**With no token configured, every `/v1` route is open.** In that mode the port
must not be reachable from an untrusted network.

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
{ "status": "ok", "version": "0.1.0", "uptimeSeconds": 7 }
```

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

Measured on this machine (Bun 1.3.14, WSL2) against
`fixtures/PROJECT_2551019_CAM_MILLING/2551019_CAM_MILLING.MPF` — 69,944,280
bytes, 228,406 events. Peak RSS is `VmHWM` from `/proc/<pid>/status`, read on a
freshly started server so the figure covers exactly one request. Baseline RSS
before the request is ~90 MB.

| Endpoint | Wall clock | Peak RSS | Response |
|---|---|---|---|
| `POST /v1/trace/profile` | 2.39 s | 712 MB | 1.4 KB |
| `POST /v1/trace/generate` | 5.81 s | 842 MB | 1.85 MB, 92 files |

**Body size — default 128 MB.** Real traces here range 8.7 MB to 67 MB, so 128 MB
leaves near-2× headroom over the largest. `Content-Length` is checked and
rejected *before* the body is buffered.

**Concurrency — default 1 parse.** At ~842 MB peak for one 67 MB generate, two
concurrent large requests would exhaust a modest host. The gate refuses rather
than queues: a caller that gets `503` plus `Retry-After` can retry, whereas one
stuck behind an unbounded queue just times out while the server slides into
swap. Raise `--max-parses` only against measured headroom on your own hardware.

**Line length — 8 KB, fixed.** The parser's key-value regex backtracks
quadratically on a long run of word characters containing no `:`:

| Single line | Parse time |
|---|---|
| 2 KB | 8 ms |
| 8 KB | 105 ms |
| 32 KB | 1.66 s |
| 64 KB | 6.59 s |

The longest line in any of this repo's seven fixtures is 877 bytes, so 8 KB
leaves ~9× headroom over genuine SolidCAM output while bounding one pathological
line to ~100 ms. Traces with a longer line are rejected `400 bad-request`.

> This guard bounds the worst case; it does not remove it. The quadratic parse
> is a defect in the core parser, and a body full of maximum-length lines is
> still far slower than a real trace. Treat this port as trusted-network only
> until that is fixed.

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

# The server holds a whole trace plus its parsed events in memory.
# Keep this above the peak RSS measured for your largest trace.
MemoryMax=2G

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
# Stateless: it never writes anything.
ReadOnlyPaths=/opt/achar

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
