"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { isFirebaseConfigured } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div className="flex min-h-screen flex-1 items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Marimar Inn</CardTitle>
          <CardDescription>Sign in to manage the front desk.</CardDescription>
        </CardHeader>
        <CardContent>
          {!isFirebaseConfigured && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                Firebase isn&apos;t configured yet. Add your project&apos;s
                values to <code>.env.local</code> — see the README for setup
                steps.
              </span>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              />
            </div>
            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
