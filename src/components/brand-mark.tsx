import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Compact icon + real CSS text lockup, for tight UI spots (mobile header,
 * loading screens) where the full plaque photo would render too small to
 * read — the wordmark stays crisp at any size because it's actual text, not
 * pixels from a photograph.
 */
export function BrandMark({
  className,
  iconClassName,
  textClassName,
}: {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/logo/icon.png"
        alt=""
        width={1312}
        height={1199}
        priority
        className={cn("h-8 w-auto shrink-0 bg-transparent", iconClassName)}
      />
      <span
        className={cn(
          "font-heading text-lg font-semibold tracking-tight text-[#0f3d3e]",
          textClassName
        )}
      >
        Marimar Inn
      </span>
    </span>
  );
}
