import { AlignLeft, FileText, Film, Image as ImageIcon } from "lucide-react";
import { mediaKind } from "@/lib/media";
import type { MediaType } from "@/lib/types";

const ICONS = {
  image: ImageIcon,
  video: Film,
  pdf: FileText,
  text: AlignLeft,
} as const;

export function TileKindMark({ type, compact }: { type?: MediaType; compact?: boolean }) {
  const Icon = ICONS[mediaKind(type)];
  return (
    <span className={`tile-mark${compact ? " is-compact" : ""}`} aria-hidden="true">
      <Icon size={compact ? 12 : 18} strokeWidth={2} />
    </span>
  );
}
