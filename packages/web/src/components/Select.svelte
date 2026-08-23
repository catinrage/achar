<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Check from 'lucide-svelte/icons/check';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';

  /**
   * A listbox that behaves like a native `<select>` and looks like the rest of
   * the app.
   *
   * The native control cannot be styled where it matters — the popup is drawn
   * by the operating system — and on a shop-floor tablet its option rows are
   * far too small to hit reliably. This keeps the keyboard contract (type-ahead
   * aside): arrows move, Enter and Space choose, Escape closes, Home and End
   * jump, and focus returns to the trigger so tabbing continues where expected.
   */

  export interface SelectOption {
    value: string;
    label: string;
    /** Secondary line, shown under the label. */
    detail?: string;
    disabled?: boolean;
  }

  interface Props {
    value: string;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    /** Labels the trigger for assistive technology. */
    label?: string;
    onchange: (value: string) => void;
  }

  let {
    value,
    options,
    placeholder = '',
    disabled = false,
    label,
    onchange,
  }: Props = $props();

  let open = $state(false);
  let active = $state(-1);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  let list = $state<HTMLUListElement | undefined>(undefined);

  const selected = $derived(options.find((option) => option.value === value));
  const selectable = $derived(
    options.map((option, index) => ({ option, index })).filter(
      (entry) => !entry.option.disabled,
    ),
  );

  const id = `select-${Math.random().toString(36).slice(2, 9)}`;

  function show() {
    if (disabled || options.length === 0) return;
    open = true;
    // Open on the current choice so the first arrow press moves from where the
    // reader already is, rather than from the top of a long list.
    active = options.findIndex((option) => option.value === value);
    if (active < 0) active = selectable[0]?.index ?? -1;
  }

  function hide(returnFocus = true) {
    open = false;
    if (returnFocus) trigger?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onchange(option.value);
    hide();
  }

  function step(direction: 1 | -1) {
    if (!open) {
      show();
      return;
    }
    const positions = selectable.map((entry) => entry.index);
    if (positions.length === 0) return;
    const current = positions.indexOf(active);
    const next =
      current === -1
        ? positions[direction === 1 ? 0 : positions.length - 1]
        : positions[
            (current + direction + positions.length) % positions.length
          ];
    active = next ?? active;
  }

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Home':
        if (!open) break;
        event.preventDefault();
        active = selectable[0]?.index ?? active;
        break;
      case 'End':
        if (!open) break;
        event.preventDefault();
        active = selectable[selectable.length - 1]?.index ?? active;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) choose(active);
        else show();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          hide();
        }
        break;
      case 'Tab':
        if (open) hide(false);
        break;
      default:
        break;
    }
  }

  // Keeps the highlighted row visible while arrowing through a long list.
  $effect(() => {
    if (!open || active < 0) return;
    list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  });
</script>

<svelte:window
  onpointerdown={(event) => {
    if (!open) return;
    const target = event.target as Node;
    if (!trigger?.parentElement?.contains(target)) hide(false);
  }}
/>

<div class="select" class:open class:disabled>
  <button
    bind:this={trigger}
    type="button"
    class="trigger"
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    aria-controls={open ? id : undefined}
    onclick={() => (open ? hide(false) : show())}
    onkeydown={onKeydown}
  >
    <span class="value" class:placeholder={!selected}>
      {selected?.label ?? placeholder}
    </span>
    <span class="chevron" aria-hidden="true"><ChevronDown size={18} /></span>
  </button>

  {#if open}
    <ul
      bind:this={list}
      {id}
      class="list"
      role="listbox"
      tabindex="-1"
      aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
      transition:fly={{ y: -6, duration: 160, easing: cubicOut }}
    >
      {#each options as option, index}
        <li
          id={`${id}-${index}`}
          data-index={index}
          role="option"
          aria-selected={option.value === value}
          aria-disabled={option.disabled}
          class:active={index === active}
          class:chosen={option.value === value}
          class:disabled={option.disabled}
          onpointerenter={() => {
            if (!option.disabled) active = index;
          }}
          onclick={() => choose(index)}
        >
          <span class="mark" aria-hidden="true">
            {#if option.value === value}<Check size={16} />{/if}
          </span>
          <span class="text">
            <span class="label">{option.label}</span>
            {#if option.detail}<small>{option.detail}</small>{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .select {
    position: relative;
  }

  .trigger {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 52px;
    padding: 0 0.9rem;
    text-align: right;
    background: var(--panel-subtle);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-fast) var(--ease-out);
  }

  .trigger:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .open .trigger {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .disabled .trigger {
    opacity: 0.55;
    cursor: default;
  }

  .value {
    overflow: hidden;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .value.placeholder {
    color: var(--faint);
    font-weight: 400;
  }

  .chevron {
    display: grid;
    place-items: center;
    color: var(--muted);
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .open .chevron {
    color: var(--accent);
    transform: rotate(180deg);
  }

  .list {
    position: absolute;
    inset-inline: 0;
    top: calc(100% + 6px);
    z-index: 30;
    max-height: 17rem;
    margin: 0;
    padding: 0.35rem;
    overflow-y: auto;
    list-style: none;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
  }

  li {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    min-height: 46px;
    padding: 0.4rem 0.55rem;
    cursor: pointer;
    border-radius: 8px;
  }

  li.active {
    background: var(--panel-strong);
  }

  li.chosen .label {
    font-weight: 700;
  }

  li.chosen.active {
    color: #fff;
    background: var(--accent);
  }

  li.disabled {
    opacity: 0.45;
    cursor: default;
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 18px;
    color: var(--accent);
  }

  li.chosen.active .mark {
    color: #fff;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }

  .text .label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .text small {
    color: var(--muted);
    font-size: 0.78rem;
  }

  li.chosen.active small {
    color: color-mix(in srgb, #fff 78%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
