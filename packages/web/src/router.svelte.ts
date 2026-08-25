/**
 * Client-side routing.
 *
 * Every generation gets its own address so a machinist can send a colleague a
 * link to the exact job rather than describing which file to look for, and so
 * a reload lands back on the same results instead of an empty upload form.
 *
 * The server already cooperates: any path without a file extension that is not
 * under an API prefix is answered with the app shell, so these URLs survive a
 * refresh and can be opened cold.
 */

export type Route =
  | { name: 'generate' }
  /**
   * An uploaded trace, by content hash.
   *
   * Worth an address of its own because the analysis outlives the choice made
   * from it: coming back tomorrow to post the next setup is a link, not a
   * second three-hundred-megabyte upload.
   */
  | { name: 'trace'; sha: string }
  | { name: 'job'; id: string }
  | { name: 'history' }
  | { name: 'machines' };

function parseRoute(pathname: string): Route {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'jobs' && segments[1]) {
    return { name: 'job', id: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === 'traces' && segments[1]) {
    return { name: 'trace', sha: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === 'history') return { name: 'history' };
  if (segments[0] === 'machines') return { name: 'machines' };
  return { name: 'generate' };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'job':
      return `/jobs/${encodeURIComponent(route.id)}`;
    case 'trace':
      return `/traces/${encodeURIComponent(route.sha)}`;
    case 'history':
      return '/history';
    case 'machines':
      return '/machines';
    default:
      return '/';
  }
}

class Router {
  current = $state<Route>(parseRoute(window.location.pathname));

  constructor() {
    // The browser's own back and forward buttons are the reason this is a
    // router at all rather than a variable holding the active tab.
    window.addEventListener('popstate', () => {
      this.current = parseRoute(window.location.pathname);
    });
  }

  go(route: Route, options: { replace?: boolean } = {}): void {
    const href = routeHref(route);
    if (href !== window.location.pathname) {
      if (options.replace) window.history.replaceState({}, '', href);
      else window.history.pushState({}, '', href);
    }
    this.current = route;
  }
}

export const router = new Router();
