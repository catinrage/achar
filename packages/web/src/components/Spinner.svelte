<script lang="ts">
  interface Props {
    /** A running job spins faster and picks up the accent. */
    running?: boolean;
    size?: number;
  }

  let { running = false, size = 34 }: Props = $props();
</script>

<!--
  An SVG ring rather than a bordered box: the dash offset animates on the
  compositor and the arc can taper, which a CSS border circle cannot do. The
  queued state turns slowly in muted grey, the running state faster and in the
  accent, so the difference is legible from across a workshop.
-->
<svg
  class="ring"
  class:running
  width={size}
  height={size}
  viewBox="0 0 40 40"
  role="presentation"
>
  <circle class="track" cx="20" cy="20" r="16" />
  <circle class="arc" cx="20" cy="20" r="16" />
</svg>

<style>
  .ring {
    flex: none;
    animation: spin 1.6s linear infinite;
  }

  .ring.running {
    animation-duration: 0.85s;
  }

  circle {
    fill: none;
    stroke-width: 4;
    stroke-linecap: round;
  }

  .track {
    stroke: var(--border-strong);
  }

  .arc {
    stroke: var(--muted);
    /* A quarter of the circumference (2πr ≈ 100.5), so the arc reads as a
       clear leading edge rather than a nearly-closed ring. */
    stroke-dasharray: 25 76;
    transition: stroke var(--duration-normal) var(--ease-out);
  }

  .running .arc {
    stroke: var(--accent);
    animation: chase 1.7s ease-in-out infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Lengthens and shortens the arc as it turns, so progress reads as motion
     even when the underlying job reports none. */
  @keyframes chase {
    0% {
      stroke-dasharray: 12 89;
    }
    50% {
      stroke-dasharray: 55 46;
    }
    100% {
      stroke-dasharray: 12 89;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring,
    .ring.running {
      animation-duration: 4s;
    }

    .running .arc {
      animation: none;
    }
  }
</style>
