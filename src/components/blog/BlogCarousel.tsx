'use client';

import { useRef, useEffect, useState } from 'react';
import Link from 'next/link';

interface Post {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  date: string;
}

interface BlogCarouselProps {
  posts: Post[];
}

export default function BlogCarousel({ posts }: BlogCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.addEventListener('scroll', checkScroll);
      checkScroll();
      window.addEventListener('resize', checkScroll);
      return () => {
        node.removeEventListener('scroll', checkScroll);
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 400;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  if (posts.length === 0) return null;

  return (
    <div className="relative group/carousel">
      {/* Controls */}
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute -left-4 top-1/2 -translate-y-1/2 z-30 h-10 w-10 rounded-full bg-surface/90 border border-hairline-strong flex items-center justify-center text-ink backdrop-blur-md hover:bg-saffron-500 hover:text-[#1c1814] transition-all opacity-0 group-hover/carousel:opacity-100"
          aria-label="Scroll left"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute -right-4 top-1/2 -translate-y-1/2 z-30 h-10 w-10 rounded-full bg-surface/90 border border-hairline-strong flex items-center justify-center text-ink backdrop-blur-md hover:bg-saffron-500 hover:text-[#1c1814] transition-all opacity-0 group-hover/carousel:opacity-100"
          aria-label="Scroll right"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Fade Overlays */}
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-paper to-transparent z-10 pointer-events-none opacity-0 group-hover/carousel:opacity-100 transition-opacity" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-paper to-transparent z-10 pointer-events-none opacity-0 group-hover/carousel:opacity-100 transition-opacity" />

      <div
        ref={scrollRef}
        className="flex gap-6 overflow-x-auto pb-8 pt-4 snap-x snap-mandatory scroll-smooth cursor-grab active:cursor-grabbing"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="vb-card vb-card-interactive vb-card-accent snap-start shrink-0 w-[320px] md:w-[420px] group relative flex flex-col justify-between overflow-hidden p-8"
          >
            <div className="relative space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center rounded-full border border-green-700/25 bg-green-700/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-green-ink">
                  {post.category}
                </span>
                <span className="font-mono text-xs text-faint">{post.date}</span>
              </div>

              <h2 className="text-xl font-bold text-ink leading-snug group-hover:text-saffron-ink transition-colors">
                {post.title}
              </h2>

              <p className="text-sm text-muted leading-relaxed line-clamp-3">
                {post.excerpt}
              </p>
            </div>

            <div className="relative mt-8 flex items-center text-sm font-bold text-saffron-ink">
              Read Article
              <svg className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
