import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  href: string;
  label: string;
  children: ReactNode;
  className?: string;
  external?: boolean;
};

export default function IconLink({ href, label, children, className, external }: Props) {
  if (!href) return null;

  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={className ?? ""}
    >
      {children}
    </Link>
  );
}
