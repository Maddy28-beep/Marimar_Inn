"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { WifiIcon, WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Always-visible online/offline pill — the front desk runs on a single
 * tablet through occasional multi-hour internet outages, and staff should
 * never be left guessing whether the app is actually working. Firestore
 * itself keeps working offline (see firebase.ts's persistent cache), this
 * is purely the "let the cashier see what's going on" piece.
 */
export function OnlineStatus() {
  const isOnline = useOnlineStatus();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      toast.success("Back online — syncing…");
    }
  }, [isOnline]);

  if (isOnline) {
    // Icon-only — the header is tight for room and the online case is the
    // common, unremarkable one. "Offline" below stays spelled out since
    // that's the rare state where a cashier needs it to be unmissable.
    return (
      <Badge variant="secondary" className="text-muted-foreground" title="Online">
        <WifiIcon className="size-3.5" />
        <span className="sr-only">Online</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="gap-1 border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
    >
      <WifiOffIcon className="size-3.5" />
      Offline — will sync
    </Badge>
  );
}
