const FRIENDLY: Record<string, string> = {
  "permission-denied": "Your account isn't allowed to do that (permission denied)",
  unauthenticated: "You were signed out — sign in again",
  unavailable: "Can't reach the server — check the internet connection",
  "deadline-exceeded": "The server took too long to answer — check the internet connection",
  "resource-exhausted": "Too many requests — wait a moment and try again",
  "auth/email-already-in-use": "An account with that email already exists",
  "auth/invalid-email": "That email address isn't valid",
  "auth/weak-password": "That password is too weak — use at least 6 characters",
  "auth/network-request-failed": "No internet connection",
  "auth/too-many-requests": "Too many attempts — wait a few minutes and try again",
  "auth/operation-not-allowed": "Email sign-in is turned off for this project",
  "auth/user-not-found": "No sign-in exists for that email",
};

/**
 * Turns a Firebase error into "what happened (technical-code)" for a toast, so
 * a failure on a staff tablet can be read back and diagnosed instead of the
 * app only saying "please try again". Always keeps the raw code when there is
 * one, since that's what pins down the cause.
 */
export function describeFirebaseError(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (code && FRIENDLY[code]) return `${fallback}: ${FRIENDLY[code]} (${code}).`;
  if (code) return `${fallback}: ${message || "unexpected error"} (${code}).`;
  if (message) return `${fallback}: ${message}`;
  return `${fallback} — please try again.`;
}
