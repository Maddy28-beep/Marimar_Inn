"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Loader2Icon } from "lucide-react";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
