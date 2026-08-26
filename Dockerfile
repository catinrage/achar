# syntax=docker/dockerfile:1

################################################################################
# Web stage — builds the workshop UI.
#
# Built here rather than committed so the image cannot ship a stale bundle, and
# so the final image carries none of the build-time dependencies (svelte, the
# compiler) that produced it.
################################################################################
FROM oven/bun:1.4.0 AS web

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

RUN bun install --frozen-lockfile --filter @achar/web

COPY packages/web/build.ts packages/web/build.ts
COPY packages/web/svelte-plugin.ts packages/web/svelte-plugin.ts
COPY packages/web/tsconfig.json packages/web/tsconfig.json
COPY packages/web/src packages/web/src

RUN NODE_ENV=production bun run --cwd packages/web build

################################################################################
# Runtime
################################################################################
FROM oven/bun:1.4.0

WORKDIR /app

# Copy workspace manifests first so dependency installation stays cached while
# application source changes.
COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

RUN bun install --production --frozen-lockfile --filter @achar/cli

# The HTTP entry point is registered by the CLI. `server` holds all of it —
# the kernel and parse workers, the stateless /v1 API, and the workshop's queue
# and browser API on top of them; all machining work lives in core.
#
# `web` stays a separate package on purpose: it is a browser build with its own
# toolchain, and the split is what keeps svelte out of the install below.
COPY packages/cli/src packages/cli/src
COPY packages/core/src packages/core/src
COPY packages/mcp/src packages/mcp/src
COPY packages/server/src packages/server/src

# Only the built assets, none of the toolchain that made them.
COPY --from=web /app/packages/web/dist packages/web/dist

# The queue's volume. Created here so its ownership is right before the
# container drops to an unprivileged user; a volume mounted over it inherits
# these permissions.
RUN mkdir -p /var/lib/achar && chown -R bun:bun /var/lib/achar

ENV NODE_ENV=production \
    ACHAR_SERVER_HOST=0.0.0.0 \
    ACHAR_SERVER_PORT=7788 \
    ACHAR_DATA_DIR=/var/lib/achar

USER bun

EXPOSE 7788

VOLUME ["/var/lib/achar"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:7788/health'); if (!response.ok) process.exit(1);"]

CMD ["bun", "packages/cli/src/index.ts", "serve"]
