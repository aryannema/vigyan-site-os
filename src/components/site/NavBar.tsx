"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { IconMenu2, IconX } from "@tabler/icons-react";

interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

interface NavBarProps {
  items?: NavItem[];
}

export default function NavBar({ items = [] }: NavBarProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="flex items-center justify-end md:justify-center">
      {/* Desktop: quiet, wide-tracked text nav with a saffron active underline */}
      <div className="hidden items-center gap-7 md:flex">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`border-b-2 pb-0.5 text-sm font-semibold transition-colors duration-200 ${
                active
                  ? "border-saffron-500 text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Mobile hamburger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center p-2 text-body transition-colors hover:text-saffron-ink md:hidden"
        aria-label="Toggle Menu"
      >
        {isOpen ? <IconX size={24} /> : <IconMenu2 size={24} />}
      </button>

      {/* Mobile menu overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
            className="vb-nav fixed inset-x-0 top-[65px] z-40 border-b border-hairline shadow-warm-lg md:hidden"
          >
            <div className="flex flex-col gap-1 p-4">
              {items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={`rounded-md px-4 py-3 text-base font-medium transition-colors ${
                      active
                        ? "bg-saffron-500/10 text-saffron-ink"
                        : "text-body hover:bg-sand"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
