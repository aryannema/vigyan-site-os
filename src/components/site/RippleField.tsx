'use client';

import { useEffect, useRef } from 'react';

interface Ripple {
  x: number;
  y: number;
  /** Seconds since birth. Drives radius and fade together so they stay in step. */
  age: number;
  /** How far it travels before vanishing, in px. */
  reach: number;
  hue: 'gold' | 'green';
  /** Ambient ripples are fainter than ones the visitor caused. */
  strength: number;
}

const GOLD = 'rgba(245,158,11,';
const GREEN = 'rgba(34,197,94,';

/** Seconds a ripple takes to travel its full reach. */
const LIFETIME = 2.6;

/**
 * RippleField — concentric rings that spread from where the visitor touches,
 * plus slow ambient ones so the surface is never completely still.
 *
 * Canvas2D like ParticleField, and for the same reason: at this size WebGL buys
 * nothing and costs a dependency. Safe to layer with ParticleField — both are
 * `pointer-events: none` and neither reads the other's state.
 *
 * Motion rules, which are not optional on a background effect:
 *   - `prefers-reduced-motion` disables it entirely. A ripple has no meaning to
 *     convey, so the honest response to "I don't want motion" is no motion at
 *     all, not slower motion.
 *   - Pauses via IntersectionObserver when scrolled out of view.
 *   - Ripples expand and fade; nothing pulses forever.
 *
 * Deliberately NOT interactive in the accessibility sense: no focus, no role,
 * `aria-hidden`. It is texture, and a screen reader should never meet it.
 */
export default function RippleField({
  ambient = true,
  maxRipples = 14,
}: {
  /** Emit slow unprompted ripples so an untouched page still breathes. */
  ambient?: boolean;
  /** Hard cap. Rings are cheap, but an idle tab should not accumulate them. */
  maxRipples?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Read once: a visitor who has asked for reduced motion gets a blank
    // canvas, and we never start a loop at all.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let ripples: Ripple[] = [];
    let raf = 0;
    let visible = true;
    let lastFrame = performance.now();
    let nextAmbient = 0;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(x: number, y: number, strength: number) {
      if (ripples.length >= maxRipples) ripples.shift();
      ripples.push({
        x,
        y,
        age: 0,
        // Vary the reach so repeated taps in one spot do not stack into a
        // single hard-edged ring.
        reach: 140 + Math.random() * 120,
        hue: Math.random() < 0.72 ? 'gold' : 'green',
        strength,
      });
    }

    /**
     * Ease-out: fast at birth, slowing as it spreads. Linear growth reads as
     * mechanical — this is what makes it look like something moving through a
     * surface rather than a circle being scaled.
     */
    function easeOut(t: number) {
      return 1 - Math.pow(1 - t, 3);
    }

    function step(now: number) {
      // Delta-time rather than per-frame increments, so the speed is the same
      // on a 60Hz laptop and a 144Hz monitor.
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      ctx!.clearRect(0, 0, width, height);

      if (ambient && now > nextAmbient) {
        spawn(Math.random() * width, Math.random() * height, 0.35);
        nextAmbient = now + 2200 + Math.random() * 2600;
      }

      for (const r of ripples) {
        r.age += dt;
        const t = r.age / LIFETIME;
        if (t >= 1) continue;

        const radius = easeOut(t) * r.reach;
        // Fade as it travels, and thin the stroke at the same time — a ring
        // that keeps its weight while growing looks like an expanding pipe.
        const alpha = (1 - t) * 0.5 * r.strength;
        const base = r.hue === 'gold' ? GOLD : GREEN;

        ctx!.beginPath();
        ctx!.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx!.strokeStyle = `${base}${alpha.toFixed(3)})`;
        ctx!.lineWidth = Math.max(0.4, 1.6 * (1 - t));
        ctx!.stroke();

        // A second ring a little behind the first: one circle reads as a
        // target, two read as a wavefront.
        if (t > 0.12) {
          const trailRadius = easeOut(Math.max(0, t - 0.12)) * r.reach;
          ctx!.beginPath();
          ctx!.arc(r.x, r.y, trailRadius, 0, Math.PI * 2);
          ctx!.strokeStyle = `${base}${(alpha * 0.45).toFixed(3)})`;
          ctx!.lineWidth = Math.max(0.3, 1.0 * (1 - t));
          ctx!.stroke();
        }
      }

      // Drop dead ripples once per frame rather than splicing mid-iteration.
      ripples = ripples.filter((r) => r.age < LIFETIME);

      if (visible) raf = requestAnimationFrame(step);
    }

    function onPointerDown(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Ignore taps outside this canvas's own box: the listener is on window so
      // it catches clicks anywhere, and a ripple from off-screen would appear
      // to come out of an edge for no reason.
      if (x < 0 || y < 0 || x > width || y > height) return;
      spawn(x, y, 1);
    }

    resize();
    lastFrame = performance.now();
    nextAmbient = lastFrame + 600;

    // Pointer events on window, not the canvas: the canvas is
    // `pointer-events: none` so it never steals a click from a link or button
    // underneath it, which is the usual way a decorative overlay breaks a page.
    window.addEventListener('pointerdown', onPointerDown, { passive: true });

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) {
          lastFrame = performance.now();
          raf = requestAnimationFrame(step);
        } else {
          cancelAnimationFrame(raf);
          // Clear on the way out so returning to the section does not show a
          // frozen frame from minutes ago.
          ripples = [];
          ctx!.clearRect(0, 0, width, height);
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onPointerDown);
      ro.disconnect();
      io.disconnect();
    };
  }, [ambient, maxRipples]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
