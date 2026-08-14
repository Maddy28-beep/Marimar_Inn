"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { BrandLogo } from "@/components/brand-logo";
import { Loader2Icon } from "lucide-react";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <BrandLogo className="h-20 w-auto" />
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
