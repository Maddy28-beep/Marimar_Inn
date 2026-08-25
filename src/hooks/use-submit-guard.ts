import { useRef, useState } from "react";

/**
 * Blocks a double-submit from a fast double-tap. `disabled={submitting}` on
 * its own isn't enough — React batches the state update, so two click
 * events fired in quick succession (routine on a touchscreen front-desk
 * tablet) can both start running before the button actually disables,
 * producing two of whatever the handler creates (e.g. two booking docs for
 * the same check-in). A ref check is synchronous and closes that gap.
 */
export function useSubmitGuard() {
  const [submitting, setSubmitting] = useState(false);
  const runningRef = useRef(false);

  async function guard(fn: () => Promise<void>) {
    if (runningRef.current) return;
    runningRef.current = true;
    setSubmitting(true);
    try {
      await fn();
    } finally {
      runningRef.current = false;
      setSubmitting(false);
    }
  }

  return { submitting, guard };
}
