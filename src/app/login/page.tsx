"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { isFirebaseConfigured } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand-logo";
import { BrandMark } from "@/components/brand-mark";
import { primeAlarmAudio } from "@/lib/alarm";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";

function firebaseAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && !("code" in error)) {
    return error.message;
  }

  const code = (error as { code?: string })?.code;
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return "Something went wrong signing in. Please try again.";
  }
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Unlocks the checkout-alarm's AudioContext as early as the sign-in tap
    // — the app shell's own unlock listener may not fire before an alarm is
    // needed if nobody touches the screen after landing on the dashboard.
    primeAlarmAudio();
    setSubmitting(true);

    try {
      await signIn(email, password);
      router.replace("/dashboard");
    } catch (error) {
      toast.error(firebaseAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#0f3d3e] lg:flex lg:flex-col lg:items-center lg:justify-center">
        {/* Soft glows echo the plaque's own magenta/teal, positioned as if
            radiating from the mark itself rather than dropped in the corners. */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 size-[26rem] -translate-x-[62%] -translate-y-[70%] rounded-full bg-[#9d2a6a]/20 blur-[100px]" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 size-[26rem] -translate-x-[38%] -translate-y-[30%] rounded-full bg-[#1a6b6d]/30 blur-[100px]" />

        <div className="relative flex flex-col items-center px-10 text-center">
          <div className="rounded-lg bg-[#0f3d3e] p-2 shadow-[0_20px_45px_-15px_rgba(0,0,0,0.55)] ring-1 ring-white/10">
            <BrandLogo className="h-40 w-auto rounded-[3px]" priority />
          </div>
          <div className="mt-7 flex items-center gap-3 text-teal-100/70">
            <span className="h-px w-8 bg-teal-100/30" />
            <p className="text-xs tracking-[0.28em] uppercase">Front desk</p>
            <span className="h-px w-8 bg-teal-100/30" />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center bg-[#f6f1ea] px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center text-center lg:mb-10 lg:items-start lg:text-left">
            <BrandMark className="mb-6 lg:hidden" textClassName="text-xl" />
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-[#1f2a2a]">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-[#5c6b6b]">
              Sign in to manage today&apos;s front desk.
            </p>
          </div>

          {!isFirebaseConfigured && (
            <div className="mb-6 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                Firebase isn&apos;t configured yet. Add your project&apos;s
                values to <code>.env.local</code> — see the README for setup
                steps.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="h-10 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="h-10 bg-white"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="mt-1 h-10 w-full bg-[#0f3d3e] text-white hover:bg-[#16494a]"
            >
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
