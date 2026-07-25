# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14

WORKDIR /app

# Copy workspace manifests first so dependency installation stays cached while
# application source changes.
COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/desktop/package.json packages/desktop/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/server/package.json packages/server/package.json

RUN bun install --production --frozen-lockfile --filter @achar/cli

# The HTTP entry point is registered by the CLI. Its static imports require the
# CLI and MCP packages, while all machining work lives in core and server.
COPY packages/cli/src packages/cli/src
COPY packages/core/src packages/core/src
COPY packages/mcp/src packages/mcp/src
COPY packages/server/src packages/server/src

ENV NODE_ENV=production \
    ACHAR_SERVER_HOST=0.0.0.0 \
    ACHAR_SERVER_PORT=7788

USER bun

EXPOSE 7788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:7788/health'); if (!response.ok) process.exit(1);"]

CMD ["bun", "packages/cli/src/index.ts", "serve"]
