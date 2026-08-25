<script lang="ts">
  import { fade } from 'svelte/transition';
  import Cog from 'lucide-svelte/icons/cog';
  import History from 'lucide-svelte/icons/history';
  import Wrench from 'lucide-svelte/icons/wrench';
  import Zap from 'lucide-svelte/icons/zap';
  import { api, type Machine } from './api';
  import { m } from './messages/fa';
  import { type Route, router, routeHref } from './router.svelte';
  import GenerateView from './views/GenerateView.svelte';
  import HistoryView from './views/HistoryView.svelte';
  import MachinesView from './views/MachinesView.svelte';

  let machines = $state<Machine[]>([]);

  /**
   * The machine list is loaded once here rather than per view: two of the three
   * views need it, and an operator switching tabs should not watch it reload.
   */
  async function loadMachines() {
    try {
      machines = await api.listMachines();
    } catch {
      machines = [];
    }
  }

  $effect(() => {
    void loadMachines();
  });

  const tabs: Array<{ route: Route; label: string; icon: typeof Zap }> = [
    { route: { name: 'generate' }, label: m.navGenerate, icon: Zap },
    { route: { name: 'history' }, label: m.navHistory, icon: History },
    { route: { name: 'machines' }, label: m.navMachines, icon: Cog },
  ];

  const active = $derived(router.current.name);
  // A job's results and a trace's analysis both live inside the generate view,
  // so its tab stays lit for either.
  const activeTab = $derived(
    active === 'job' || active === 'trace' ? 'generate' : active,
  );

  /**
   * Intercepts a left-click on an in-app link.
   *
   * The links are real `<a href>` elements so they can be copied, opened in a
   * new tab and read by assistive technology; this only takes over the plain
   * click, leaving modified clicks to the browser.
   */
  function navigate(event: MouseEvent, route: Route) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    router.go(route);
  }
</script>

<header class="masthead">
  <div class="shell masthead-inner">
    <a
      class="brand"
      href={routeHref({ name: 'generate' })}
      onclick={(event) => navigate(event, { name: 'generate' })}
    >
      <span class="brand-mark" aria-hidden="true"><Wrench size={22} /></span>
      <span class="brand-text">
        <strong>{m.appName}</strong>
        <small>{m.appTagline}</small>
      </span>
    </a>

    <nav aria-label={m.navAriaLabel}>
      {#each tabs as tab (tab.route.name)}
        {@const isActive = activeTab === tab.route.name}
        <a
          class="tab"
          class:active={isActive}
          href={routeHref(tab.route)}
          aria-current={isActive ? 'page' : undefined}
          onclick={(event) => navigate(event, tab.route)}
        >
          <tab.icon size={17} />
          <span>{tab.label}</span>
        </a>
      {/each}
    </nav>
  </div>
</header>

<main class="shell">
  {#key activeTab}
    <div in:fade={{ duration: 140 }}>
      {#if active === 'generate' || active === 'job' || active === 'trace'}
        <GenerateView
          {machines}
          jobId={router.current.name === 'job' ? router.current.id : undefined}
          traceSha={router.current.name === 'trace'
            ? router.current.sha
            : undefined}
        />
      {:else if active === 'history'}
        <HistoryView />
      {:else}
        <MachinesView {machines} onchange={loadMachines} />
      {/if}
    </div>
  {/key}
</main>

<style>
  .shell {
    width: 100%;
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 clamp(1rem, 3vw, 2rem);
  }

  .masthead {
    position: sticky;
    top: 0;
    z-index: 20;
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }

  .masthead-inner {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    min-height: 72px;
    padding-block: 0.75rem;
  }

  .brand {
    display: flex;
    gap: 0.7rem;
    align-items: center;
    color: inherit;
    text-decoration: none;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    color: #fff;
    background: linear-gradient(140deg, var(--accent-soft), var(--accent-strong));
    border-radius: 12px;
    box-shadow: var(--shadow-sm);
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .brand:hover .brand-mark {
    transform: rotate(-12deg) scale(1.05);
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }

  .brand-text strong {
    font-size: 1.15rem;
  }

  .brand-text small {
    color: var(--muted);
    font-size: 0.82rem;
  }

  nav {
    display: flex;
    gap: 0.3rem;
    padding: 0.3rem;
    background: var(--panel-strong);
    border-radius: 999px;
  }

  .tab {
    display: inline-flex;
    gap: 0.45rem;
    align-items: center;
    /* 44px minimum: this is used with gloves on, on a tablet. */
    min-height: 44px;
    padding: 0 1.05rem;
    color: var(--muted);
    font-weight: 600;
    text-decoration: none;
    border-radius: 999px;
    transition:
      background var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    color: var(--text);
    background: var(--panel);
    box-shadow: var(--shadow-sm);
  }

  .tab.active :global(svg) {
    color: var(--accent);
  }

  /*
   * Qualified with the element so it outweighs `.shell`, whose `padding`
   * shorthand would otherwise reset the vertical padding to zero and leave the
   * content welded to the masthead above and the viewport edge below.
   */
  main.shell {
    padding-block: clamp(1.5rem, 4vw, 2.75rem) clamp(3rem, 6vw, 5rem);
  }

  @media (prefers-reduced-motion: reduce) {
    .brand:hover .brand-mark {
      transform: none;
    }
  }
</style>
