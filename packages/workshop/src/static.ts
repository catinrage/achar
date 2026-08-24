import path from 'node:path';
import type { RouteResponse } from '@achar/server';

/**
 * Serves the built web UI.
 *
 * The UI is a handful of static files, so there is no need for a separate web
 * server in front: the same process that runs the queue hands out the page
 * that drives it, which keeps the deployment to one container.
 *
 * Unknown paths without a file extension fall back to `index.html` so client
 * routes survive a refresh; a missing asset still 404s, because silently
 * answering a missing stylesheet with HTML makes the failure much harder to
 * see than the 404 would have been.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

const INDEX = 'index.html';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export async function serveStatic(
  webRoot: string | undefined,
  pathname: string,
): Promise<RouteResponse | undefined> {
  if (!webRoot) return undefined;

  const requested = pathname === '/' ? `/${INDEX}` : pathname;
  const resolved = resolveWithin(webRoot, requested);
  if (resolved) {
    const response = await readAsset(resolved);
    if (response) return response;
  }

  // A path that looks like a file the caller expected to exist should not be
  // answered with the app shell.
  if (path.extname(requested) !== '') return undefined;

  const fallback = path.join(webRoot, INDEX);
  return readAsset(fallback);
}

async function readAsset(filePath: string): Promise<RouteResponse | undefined> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return undefined;

  const extension = path.extname(filePath);
  return {
    status: 200,
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
    headers: {
      // Hashed bundle filenames may be cached forever; everything else has to
      // be revalidated or a deploy leaves stale HTML pinned in every browser
      // on the shop floor.
      'cache-control': /\.[0-9a-f]{8,}\./.test(path.basename(filePath))
        ? IMMUTABLE
        : REVALIDATE,
    },
  };
}

/**
 * Joins a request path onto the web root, refusing anything that escapes it.
 *
 * The path arrives from the network, so `..` segments and absolute paths are
 * checked against the resolved root rather than filtered out of the input —
 * the filter is the part that is easy to get subtly wrong.
 */
function resolveWithin(root: string, requested: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(
    resolvedRoot,
    `.${path.posix.normalize(decoded)}`,
  );
  return candidate === resolvedRoot ||
    candidate.startsWith(`${resolvedRoot}${path.sep}`)
    ? candidate
    : undefined;
}
