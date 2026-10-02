'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface OfferingCard {
  title: string;
  blurb: string;
  items: string;
  href: string;
}

const SPEED_PX_PER_FRAME: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 0.4,
  normal: 0.8,
  fast: 1.6,
};

export function OfferingsMarquee({
  cards,
  direction = 'right',
  speed = 'slow',
}: {
  cards: OfferingCard[];
  direction?: 'left' | 'right';
  speed?: 'slow' | 'normal' | 'fast';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLUListElement>(null);
  const [ready, setReady] = useState(false);

  // Auto-scroll (real scrollLeft, not a CSS transform) + mouse drag-to-scroll +
  // wheel-to-horizontal. All three share one scrollLeft so they never fight
  // each other the way a CSS keyframe animation would against native scroll.
  useEffect(() => {
    const container = containerRef.current;
    const scroller = scrollerRef.current;
    if (!container || !scroller) return;

    // Duplicate the card set once so the loop-around point is invisible.
    //
    // The clones are decoration: they exist to hide the seam, and they carry no
    // information the original set does not. Left unmarked they are announced a
    // second time by a screen reader, and their links join the tab order — so a
    // keyboard user tabs through ten "See more" links to reach five
    // destinations. `inert` removes them from both the accessibility tree and
    // the tab order in one attribute; aria-hidden alone would do neither for
    // the links inside, and is invalid on a focusable element anyway.
    const originalChildren = Array.from(scroller.children);
    originalChildren.forEach((item) => {
      const clone = item.cloneNode(true) as HTMLElement;
      clone.setAttribute('inert', '');
      clone.setAttribute('aria-hidden', 'true');
      clone.dataset.marqueeClone = 'true';
      scroller.appendChild(clone);
    });
    setReady(true);

    const dir = direction === 'right' ? -1 : 1;
    const pxPerFrame = SPEED_PX_PER_FRAME[speed];

    // Start roughly mid-loop for 'right' so it never visibly snaps at 0.
    let halfWidth = scroller.scrollWidth / 2;
    if (dir === -1) container.scrollLeft = halfWidth;

    let paused = false;
    let pointerDown = false;
    let dragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
    let activePointerId: number | null = null;
    let rafId = 0;
    const DRAG_THRESHOLD_PX = 6;

    const normalizeLoop = () => {
      halfWidth = scroller.scrollWidth / 2;
      if (container.scrollLeft <= 0) container.scrollLeft += halfWidth;
      else if (container.scrollLeft >= halfWidth) container.scrollLeft -= halfWidth;
    };

    const tick = () => {
      if (!paused && !dragging) {
        container.scrollLeft += pxPerFrame * dir;
        normalizeLoop();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // Pointer capture is deferred until the pointer actually moves past a
    // threshold — capturing on plain pointerdown retargets the synthesized
    // click to this container, silently swallowing clicks on the "See more"
    // links inside.
    const onPointerDown = (e: PointerEvent) => {
      pointerDown = true;
      dragStartX = e.clientX;
      dragStartScroll = container.scrollLeft;
      activePointerId = e.pointerId;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointerDown) return;
      const dx = e.clientX - dragStartX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        if (activePointerId !== null) container.setPointerCapture(activePointerId);
        container.style.cursor = 'grabbing';
      }
      container.scrollLeft = dragStartScroll - dx;
      normalizeLoop();
    };
    const endDrag = () => {
      pointerDown = false;
      dragging = false;
      activePointerId = null;
      container.style.cursor = 'grab';
    };
    // Only claim a wheel gesture that is genuinely HORIZONTAL. The previous
    // version fed deltaY into scrollLeft and called preventDefault()
    // unconditionally, which trapped the page: this marquee is full-width, so
    // a visitor scrolling down the homepage with the pointer over it simply
    // stopped moving. normalizeLoop() makes the strip infinite, so the
    // carousel never "ran out" to release them either -- the only escape was
    // moving the mouse off it.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical intent -> let the page scroll
      if (e.deltaX === 0) return;
      e.preventDefault();
      container.scrollLeft += e.deltaX * 2.5;
      normalizeLoop();
    };
    const onEnter = () => { paused = true; };
    const onLeave = () => { paused = false; };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
    container.addEventListener('pointerleave', endDrag);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mouseenter', onEnter);
    container.addEventListener('mouseleave', onLeave);

    return () => {
      // Remove the clones this run appended. The effect re-runs whenever
      // `direction` or `speed` changes, and React's dev-mode double-invoke
      // fires it twice on mount — without this, each pass clones the set that
      // already includes the previous pass's clones, so the row doubles every
      // time (5 -> 10 -> 20). The data attribute is what makes "the clones"
      // identifiable; the originals never carry it.
      scroller
        .querySelectorAll<HTMLElement>('[data-marquee-clone="true"]')
        .forEach((clone) => clone.remove());

      cancelAnimationFrame(rafId);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', endDrag);
      container.removeEventListener('pointercancel', endDrag);
      container.removeEventListener('pointerleave', endDrag);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mouseenter', onEnter);
      container.removeEventListener('mouseleave', onLeave);
    };
  }, [direction, speed]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'scroller relative w-full cursor-grab select-none overflow-x-auto overflow-y-hidden',
        '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        '[mask-image:linear-gradient(to_right,transparent,white_8%,white_92%,transparent)]'
      )}
    >
      <ul
        ref={scrollerRef}
        className={cn('flex w-max shrink-0 flex-nowrap gap-6 py-2', !ready && 'opacity-0')}
      >
        {cards.map((card, i) => (
          <li
            key={`${card.title}-${i}`}
            className="vb-card flex w-[300px] shrink-0 flex-col justify-between p-7 md:w-[360px]"
          >
            <div>
              <h3 className="text-lg font-bold text-ink">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{card.blurb}</p>
              <p className="mt-4 text-xs leading-relaxed text-faint">{card.items}</p>
            </div>
            <Link href={card.href} className="mt-6 inline-flex items-center text-sm font-bold text-saffron-ink">
              See more
              <svg className="ml-1.5 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
