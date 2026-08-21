"use client";

import { cn } from "@/lib/utils";
import { ShoppingBagIcon } from "lucide-react";

export function StoreCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-36 w-full flex-col gap-0.5 overflow-hidden rounded-xl border p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        "border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/15"
      )}
    >
      <ShoppingBagIcon
        className="pointer-events-none absolute -right-3 -bottom-3 size-20 rotate-[-8deg] text-sky-600/70 opacity-[0.12] dark:text-sky-400/60"
        strokeWidth={1.5}
      />
      <div className="flex items-start justify-between gap-2">
        <span className="font-heading text-xl leading-none font-semibold">Store</span>
        <span className="mt-1 size-2.5 shrink-0 rounded-full bg-sky-500" />
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <ShoppingBagIcon className="size-3 shrink-0 text-sky-600/70 dark:text-sky-400/60" strokeWidth={2} />
        Walk-in · No room
      </div>
      <div className="mt-auto text-sm font-medium text-sky-800 dark:text-sky-300">
        Colgate, shampoo, water…
      </div>
    </button>
  );
}
