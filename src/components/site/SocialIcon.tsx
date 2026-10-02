import type { SimpleIcon } from "simple-icons";

type Props = {
  icon: SimpleIcon;
  title?: string;
  className?: string;
  useBrandColor?: boolean;
  color?: string; // e.g. "#FFFFFF"
};

export default function SocialIcon({ icon, title, className, useBrandColor, color }: Props) {
  const fill = color ?? (useBrandColor ? `#${icon.hex}` : "currentColor");

  return (
    <svg
      role="img"
      aria-label={title ?? icon.title}
      viewBox="0 0 24 24"
      className={className}
      fill={fill}
    >
      <title>{title ?? icon.title}</title>
      <path d={icon.path} />
    </svg>
  );
}
