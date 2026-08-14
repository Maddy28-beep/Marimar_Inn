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
import { subscribeToActiveBookings } from "@/lib/bookings";
import { subscribeToRooms } from "@/lib/rooms";
import { syncCheckoutReminder } from "@/lib/notifications";
import { useNowTick } from "@/hooks/use-now-tick";
import type { Booking, Room } from "@/lib/types";
import {
  LogOutIcon,
  MenuIcon,
  PackageIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  { href: "/users", label: "Manage Staff", icon: UsersIcon, ownerOnly: true },
];

function AppShell({ children }: { children: React.ReactNode }) {
  const { appUser, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useCheckoutReminderScanner();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const visibleLinks = NAV_LINKS.filter(
    (link) => !link.ownerOnly || appUser?.role === "owner"
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="font-heading text-lg font-semibold tracking-tight">
            Marimar Inn
          </span>
          {appUser && (
            <Badge variant="secondary" className="capitalize">
              {appUser.role}
            </Badge>
          )}
          <nav className="hidden items-center gap-1 md:flex">
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

        <div className="hidden items-center gap-3 md:flex">
          <NotificationBell />
          <span className="text-sm text-muted-foreground">
            {appUser?.displayName ?? appUser?.email}
          </span>
          <Separator orientation="vertical" className="h-5" />
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOutIcon className="size-4" />
            Sign out
          </Button>
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <NotificationBell />
          <Button variant="ghost" size="icon" onClick={() => setMenuOpen(true)}>
            <MenuIcon className="size-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </div>
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-4/5 flex-col p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Marimar Inn</SheetTitle>
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
            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              <LogOutIcon className="size-4" />
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
