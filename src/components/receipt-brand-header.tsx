"use client";

import { cn } from "@/lib/utils";

/** Logo + title used on guest receipts (screen and browser print). */
export function ReceiptBrandHeader({
  subtitle,
  reference,
}: {
  subtitle: string;
  reference?: string;
}) {
  return (
    <div className="text-center">
      {/* Regular img so browser print is not blocked by next/image wrappers. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo/icon.png"
        alt="Marimar Inn"
        width={160}
        height={146}
        className="mx-auto mb-2 h-16 w-auto bg-transparent object-contain print:h-20"
      />
      <div className="font-heading text-base font-semibold">Marimar Inn</div>
      <div className={cn("text-xs text-muted-foreground")}>{subtitle}</div>
      {reference ? (
        <div className="text-xs text-muted-foreground">Ref: {reference}</div>
      ) : null}
    </div>
  );
}
