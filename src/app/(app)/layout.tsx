"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { PrinterStatus } from "@/components/printer-status";
import { CashDrawerControl } from "@/components/cash-drawer-control";
import { subscribeToActiveBookings } from "@/lib/bookings";
import { subscribeToRooms } from "@/lib/rooms";
import { syncCheckoutReminder } from "@/lib/notifications";
import { primeAlarmAudio, resumeAlarmAudio } from "@/lib/alarm";
import { useNowTick } from "@/hooks/use-now-tick";
import { useCheckoutAlarm } from "@/hooks/use-checkout-alarm";
import type { Booking, Room } from "@/lib/types";
import {
  BarChart3Icon,
  Loader2Icon,
  LogOutIcon,
  MenuIcon,
  PackageIcon,
  RefreshCwIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

function HeaderClock({ className }: { className?: string }) {
  const now = useNowTick(30_000);
  const label = now.toLocaleString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return <span className={cn("text-sm text-muted-foreground", className)}>{label}</span>;
}

function useCheckoutReminderScanner() {
  const [bookingsByRoom, setBookingsByRoom] = useState<Map<string, Booking>>(new Map());
  const [roomsById, setRoomsById] = useState<Map<string, Room>>(new Map());
  const now = useNowTick(30_000);

  useEffect(() => subscribeToActiveBookings(setBookingsByRoom), []);
  useEffect(
    () => subscribeToRooms((rooms) => setRoomsById(new Map(rooms.map((r) => [r.roomId, r])))),
    []
  );

  useEffect(() => {
    bookingsByRoom.forEach((booking) => {
      const room = roomsById.get(booking.roomId);
      if (room) syncCheckoutReminder(booking, room, now).catch(() => {});
    });
    // Re-scan whenever the active bookings/rooms sets change or the 30s tick fires.
  }, [bookingsByRoom, roomsById, now]);
}

interface NavLink {
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
}

const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Rooms" },
  { href: "/rooms/manage", label: "Manage Rooms", icon: SettingsIcon, ownerOnly: true },
  { href: "/inventory", label: "Inventory", icon: PackageIcon, ownerOnly: true },
  { href: "/reports", label: "Reports", icon: BarChart3Icon },
  { href: "/users", label: "Manage Staff", icon: UsersIcon, ownerOnly: true },
];

function AppShell({ children }: { children: React.ReactNode }) {
  const { appUser, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useCheckoutReminderScanner();
  useCheckoutAlarm();

  // Browsers block audio until the page has seen a user gesture — unlock the
  // alarm's AudioContext on the first tap/click/keypress so it's ready by
  // the time a real checkout alarm needs to fire, not silently blocked.
  // touchstart is listed separately from pointerdown since some mobile
  // WebKit versions only count the former as a valid unlock gesture.
  useEffect(() => {
    function unlock() {
      primeAlarmAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    }
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("touchstart", unlock);
    window.addEventListener("keydown", unlock);

    // A locked/backgrounded phone or tablet suspends the AudioContext, and
    // iOS won't resume it on its own once the app is visible again.
    function handleVisibility() {
      if (document.visibilityState === "visible") resumeAlarmAudio();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    window.location.reload();
  }

  async function handleSignOut() {
    // No visible feedback while firebaseSignOut() was in flight made the
    // button feel unresponsive on slower tablets — it stayed fully
    // clickable with nothing on screen showing the tap had registered.
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  }

  const visibleLinks = NAV_LINKS.filter(
    (link) => !link.ownerOnly || appUser?.role === "owner"
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/dashboard" className="shrink-0">
            <BrandLogo className="h-11 w-auto sm:h-12" />
          </Link>
          {appUser && (
            <Badge variant="secondary" className="capitalize">
              {appUser.role}
            </Badge>
          )}
          <nav className="hidden items-center gap-1 lg:flex">
            {visibleLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground",
                  pathname === link.href && "bg-muted text-foreground"
                )}
              >
                {link.icon && <link.icon className="size-3.5" />}
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-4 lg:flex">
          <HeaderClock />
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-4">
            <PrinterStatus />
            <CashDrawerControl />
            <NotificationBell />
            <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCwIcon className={cn("size-5", refreshing && "animate-spin")} />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">
            {appUser?.displayName ?? appUser?.email}
          </span>
          <Separator orientation="vertical" className="h-5" />
          <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? <Loader2Icon className="size-4 animate-spin" /> : <LogOutIcon className="size-4" />}
            Sign out
          </Button>
        </div>

        <div className="flex items-center gap-3 lg:hidden">
          <PrinterStatus />
          <CashDrawerControl />
          <NotificationBell />
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2Icon className="size-5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-5" />
            )}
            <span className="sr-only">Refresh</span>
          </Button>
          {/* Directly tappable, not tucked inside the hamburger menu — a
              tablet in the sub-lg bucket otherwise needs two taps (open
              the sheet, then find Sign out at its bottom) just to log out. */}
          <Button variant="ghost" size="icon" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? (
              <Loader2Icon className="size-5 animate-spin" />
            ) : (
              <LogOutIcon className="size-5" />
            )}
            <span className="sr-only">Sign out</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setMenuOpen(true)}>
            <MenuIcon className="size-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </div>
      </header>

      <div className="border-b bg-muted/30 px-4 py-1 text-center lg:hidden">
        <HeaderClock className="text-xs" />
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-4/5 flex-col p-0">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center">
              <BrandLogo className="h-12 w-auto" />
              <span className="sr-only">Marimar Inn</span>
            </SheetTitle>
            {appUser && (
              <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
                <span className="truncate">{appUser.displayName ?? appUser.email}</span>
                <Badge variant="secondary" className="shrink-0 capitalize">
                  {appUser.role}
                </Badge>
              </div>
            )}
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-3">
            {visibleLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                  pathname === link.href && "bg-muted text-foreground"
                )}
              >
                {link.icon && <link.icon className="size-4" />}
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto border-t p-3">
            <Button variant="outline" className="w-full" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? <Loader2Icon className="size-4 animate-spin" /> : <LogOutIcon className="size-4" />}
              Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex-1 bg-muted/20 p-4 sm:p-6">{children}</main>
    </div>
  );
}

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
