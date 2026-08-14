"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import type { UserRole } from "@/lib/types";
import { BrandLogo } from "@/components/brand-logo";
import { Loader2Icon } from "lucide-react";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!user || !appUser) {
      router.replace("/login");
      return;
    }

    if (allowedRoles && !allowedRoles.includes(appUser.role)) {
      router.replace("/dashboard");
    }
  }, [loading, user, appUser, allowedRoles, router]);

  if (loading || !user || !appUser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <BrandLogo className="h-20 w-auto" />
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (allowedRoles && !allowedRoles.includes(appUser.role)) {
    return null;
  }

  return <>{children}</>;
}
