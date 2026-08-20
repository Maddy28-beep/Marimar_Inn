"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PrinterIcon } from "lucide-react";
import { RECEIPT_ICON_PNG_DATA_URL } from "@/lib/receipt-icon";
import type { ReceiptPreviewLine } from "@/lib/receipt-printer";

export function ReceiptPreviewStrip({
  lines,
  paperWidth,
  className,
}: {
  lines: ReceiptPreviewLine[];
  paperWidth: 32 | 48;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-center", className)}>
      <div
        className="overflow-hidden rounded-sm border border-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_8px_16px_-8px_rgba(0,0,0,0.25)]"
        style={{
          width: `calc(${paperWidth}ch + 1.5rem)`,
          background: "linear-gradient(180deg, #fbf7ea 0%, #f0e6cc 100%)",
        }}
      >
        <div
          className="px-3 py-4 text-[12px] leading-[1.2] text-neutral-900"
          style={{
            fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
          }}
        >
          {lines.map((line, index) =>
            line.logo ? (
              <div key={index} className="mb-1 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={RECEIPT_ICON_PNG_DATA_URL}
                  alt=""
                  width={96}
                  height={80}
                  className="h-10 w-auto"
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
            ) : (
              <div
                key={index}
                className={
                  line.align === "center"
                    ? "text-center whitespace-pre"
                    : line.align === "right"
                      ? "text-right whitespace-pre"
                      : "text-left whitespace-pre"
                }
              >
                {line.text || "\u00a0"}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function ReceiptPreviewDialog({
  open,
  onOpenChange,
  lines,
  paperWidth,
  title = "Receipt preview",
  description = "This is how it will look on the thermal printer.",
  onPrint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: ReceiptPreviewLine[];
  paperWidth: 32 | 48;
  title?: string;
  description?: string;
  onPrint?: () => void | Promise<void>;
}) {
  const [printing, setPrinting] = useState(false);

  async function handlePrint() {
    if (!onPrint) return;
    setPrinting(true);
    try {
      await onPrint();
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[min(70dvh,32rem)] overflow-y-auto py-1">
          <ReceiptPreviewStrip lines={lines} paperWidth={paperWidth} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onPrint ? (
            <Button onClick={() => void handlePrint()} disabled={printing}>
              <PrinterIcon className="size-4" />
              {printing ? "Printing…" : "Print"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
