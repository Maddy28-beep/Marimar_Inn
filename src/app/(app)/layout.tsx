"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LogOutIcon, SettingsIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function AppShell({ children }: { children: React.ReactNode }) {
  const { appUser, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-heading text-lg font-semibold tracking-tight">
            Marimar Inn
          </span>
          {appUser && (
            <Badge variant="secondary" className="capitalize">
              {appUser.role}
            </Badge>
          )}
          <nav className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className={cn(
                "rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground",
                pathname === "/dashboard" && "bg-muted text-foreground"
              )}
            >
              Rooms
            </Link>
            {appUser?.role === "owner" && (
              <Link
                href="/rooms/manage"
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground",
                  pathname === "/rooms/manage" && "bg-muted text-foreground"
                )}
              >
                <SettingsIcon className="size-3.5" />
                Manage Rooms
              </Link>
            )}
            {appUser?.role === "owner" && (
              <Link
                href="/users"
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground",
                  pathname === "/users" && "bg-muted text-foreground"
                )}
              >
                <UsersIcon className="size-3.5" />
                Manage Staff
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {appUser?.displayName ?? appUser?.email}
          </span>
          <Separator orientation="vertical" className="h-5" />
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOutIcon className="size-4" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1 bg-muted/20 p-6">{children}</main>
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
