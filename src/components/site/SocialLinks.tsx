"use client";

import Image from "next/image";
import * as SI from "simple-icons";
import type { SimpleIcon } from "simple-icons";
import SocialIcon from "@/components/site/SocialIcon";
import IconLink from "@/components/site/IconLink";

export interface SocialItem {
  platform: string;
  href: string;
  iconKey?: string;
  assetSrc?: string;
  assetDarkSrc?: string;
  forceColor?: string;
  badgeClass?: string;
}

interface SocialLinksProps {
  items?: SocialItem[];
}

type SimpleItem = {
  kind: "simple";
  label: string;
  href: string;
  iconKey: string;
  forceColor?: string;
};

type AssetItem = {
  kind: "asset";
  label: string;
  href: string;
  src: string;
  darkSrc?: string;
  badgeClass?: string;
};

type Renderable = (SimpleItem & { icon: SimpleIcon }) | AssetItem;

function pickSimpleIcon(key: string): SimpleIcon | null {
  return ((SI as unknown as Record<string, SimpleIcon | undefined>)[key] ?? null);
}

function isSvg(src: string) {
  return src.toLowerCase().endsWith(".svg");
}

function buildRenderables(items: SocialItem[]): Renderable[] {
  const out: Renderable[] = [];
  for (const item of items) {
    if (!item.href) continue;

    if (item.assetSrc) {
      out.push({
        kind: "asset",
        label: item.platform,
        href: item.href,
        src: item.assetSrc,
        darkSrc: item.assetDarkSrc,
        badgeClass: item.badgeClass
      });
      continue;
    }

    if (item.iconKey) {
      const icon = pickSimpleIcon(item.iconKey);
      if (icon) {
        out.push({
          kind: "simple",
          label: item.platform,
          href: item.href,
          iconKey: item.iconKey,
          forceColor: item.forceColor,
          icon
        });
      }
    }
  }
  return out;
}

export default function SocialLinks({ items = [] }: SocialLinksProps) {
  const renderables = buildRenderables(items);
  if (renderables.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {renderables.map((item) => (
        <IconLink
          key={item.label}
          href={item.href}
          label={item.label}
          external
          className="rounded-lg p-2 transition hover:bg-slate-900/5 dark:hover:bg-white/10"
        >
          <span
            className={[
              "inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10",
              item.kind === "asset" && item.badgeClass ? item.badgeClass : "",
            ].join(" ")}
          >
            {item.kind === "asset" ? (
              <>
                {item.darkSrc ? (
                  <>
                    <Image
                      src={item.src}
                      alt={item.label}
                      width={22}
                      height={22}
                      className="object-contain block dark:hidden"
                    />
                    <Image
                      src={item.darkSrc}
                      alt={item.label}
                      width={22}
                      height={22}
                      className="object-contain hidden dark:block"
                    />
                  </>
                ) : (
                  isSvg(item.src) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.src}
                      alt={item.label}
                      width={22}
                      height={22}
                      style={{ objectFit: "contain", display: "block" }}
                    />
                  ) : (
                    <Image
                      src={item.src}
                      alt={item.label}
                      width={22}
                      height={22}
                      className="object-contain"
                    />
                  )
                )}
              </>
            ) : (
              <SocialIcon
                icon={item.icon}
                className="h-5 w-5"
                color={item.kind === "simple" ? item.forceColor : undefined}
                useBrandColor={item.kind === "simple" ? !item.forceColor : true}
              />
            )}
          </span>
        </IconLink>
      ))}
    </div>
  );
}
