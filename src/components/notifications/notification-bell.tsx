"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/context/auth-context";
import { useFrontDesk } from "@/context/front-desk-context";
import { subscribeToNotifications, markAsRead, markAllAsRead } from "@/lib/notifications";
import { playOverdueAlarm } from "@/lib/alarm";
import { canApproveVoid } from "@/lib/roles";
import { VoidRequestReviewDialog } from "@/components/notifications/void-request-review-dialog";
import type { AppNotification } from "@/lib/types";
import { BellIcon, CheckIcon, Volume2Icon } from "lucide-react";

function timeAgo(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function NotificationBell() {
  const { appUser } = useAuth();
  const { pendingVoidRequestsByBookingId } = useFrontDesk();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [voidReviewOpen, setVoidReviewOpen] = useState(false);

  useEffect(() => subscribeToNotifications(setNotifications), []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!appUser) return null;

  const unread = notifications.filter((n) => !n.readBy.includes(appUser.uid));
  const canReviewVoidRequests = canApproveVoid(appUser.role);
  const pendingVoidRequests = Array.from(pendingVoidRequestsByBookingId.values())
    .flat()
    .sort((a, b) => (a.requestedAt?.toMillis() ?? 0) - (b.requestedAt?.toMillis() ?? 0));

  async function handleMarkRead(id: string) {
    try {
      await markAsRead(id, appUser!.uid);
    } catch {
      toast.error("Couldn't mark as read — please try again.");
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllAsRead(unread.map((n) => n.notificationId), appUser!.uid);
    } catch {
      toast.error("Couldn't mark all as read — please try again.");
    }
  }

  return (
    <>
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <BellIcon className="size-5" />
        {unread.length > 0 && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-medium text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
        <span className="sr-only">Notifications</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-medium">Notifications</span>
          {unread.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        {canReviewVoidRequests && pendingVoidRequests.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-b bg-amber-500/10 px-3 py-2">
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {pendingVoidRequests.length} void request{pendingVoidRequests.length > 1 ? "s" : ""}{" "}
              awaiting approval
            </span>
            <Button
              variant="outline"
              size="xs"
              className="shrink-0 text-amber-700 dark:text-amber-400"
              onClick={() => setVoidReviewOpen(true)}
            >
              Review
            </Button>
          </div>
        )}
        <div className="flex max-h-80 flex-col overflow-y-auto">
          {notifications.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Nothing to show right now.
            </p>
          )}
          {notifications.map((n) => {
            const isUnread = !n.readBy.includes(appUser.uid);
            return (
              <div
                key={n.notificationId}
                className={
                  isUnread
                    ? "flex items-start justify-between gap-2 border-b bg-accent/40 p-3 text-sm last:border-b-0"
                    : "flex items-start justify-between gap-2 border-b p-3 text-sm text-muted-foreground last:border-b-0"
                }
              >
                <div className="flex flex-col gap-0.5">
                  <span>{n.message}</span>
                  {n.createdAt && (
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(n.createdAt.toDate(), now)}
                    </span>
                  )}
                </div>
                {isUnread && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    onClick={() => handleMarkRead(n.notificationId)}
                  >
                    <CheckIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => playOverdueAlarm()}
          >
            <Volume2Icon className="size-3.5" />
            Test alarm sound
          </Button>
        </div>
      </PopoverContent>
    </Popover>
    {voidReviewOpen && (
      <VoidRequestReviewDialog
        requests={pendingVoidRequests}
        onClose={() => setVoidReviewOpen(false)}
      />
    )}
    </>
  );
}
