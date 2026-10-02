import type { ComponentType, SVGProps } from "react";
import { Mail, MapPin, Phone } from "lucide-react";
import { siteConfig } from "@/config/site";
import IconLink from "@/components/site/IconLink";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

type Item = {
  href: string;
  label: string;
  Icon: IconType;
  external?: boolean;
};

function normalizePhoneDigits(s: string) {
  return (s || "").replace(/[^\d+]/g, "");
}

const ITEMS: Item[] = [
  {
    href: siteConfig.links.contact.email ? `mailto:${siteConfig.links.contact.email}` : "",
    label: "Email",
    Icon: Mail,
  },
  {
    href: siteConfig.links.contact.phone ? `tel:${normalizePhoneDigits(siteConfig.links.contact.phone)}` : "",
    label: "Call",
    Icon: Phone,
  },
  {
    href: siteConfig.links.contact.locationUrl ?? "",
    label: "Location",
    Icon: MapPin,
    external: true,
  },
].filter((i) => Boolean(i.href));

export default function ContactLinks() {
  if (ITEMS.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      {ITEMS.map((i) => (
        <IconLink
          key={i.label}
          href={i.href}
          label={i.label}
          external={i.external}
           className="rounded-lg p-2 text-brand-primary transition hover:text-brand-bytes hover:bg-slate-900/5 dark:hover:bg-brand-primary/10 hover:shadow-[0_0_12px_rgba(245,158,11,0.2)] dark:hover:shadow-[0_0_12px_rgba(245,158,11,0.4)]"
        >
          <i.Icon className="h-5 w-5" strokeWidth={2} />
        </IconLink>
      ))}
    </div>
  );
}
