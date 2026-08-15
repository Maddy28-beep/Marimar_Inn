// Alarm sounds are synthesized client-side via the Web Audio API — no audio
// file to host or license, and zero server/Firestore cost either way.

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

/**
 * Browsers block audio until the page has seen at least one user gesture.
 * Call this from a click/keydown handler as early as possible so the
 * AudioContext is already unlocked by the time a real alarm needs to fire.
 */
export function primeAlarmAudio() {
  getAudioContext();
}

function beep(ctx: AudioContext, frequency: number, startTime: number, duration: number, gainValue: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(gainValue, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** Soft two-note chime — used once when a room first hits the 30-minute warning. */
export function playWarningChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  beep(ctx, 660, now, 0.16, 0.1);
  beep(ctx, 880, now + 0.2, 0.16, 0.1);
}

/** Urgent triple alarm — used when a room goes overdue, and repeated until checked out. */
export function playOverdueAlarm() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    beep(ctx, 900, now + i * 0.3, 0.22, 0.2);
    beep(ctx, 650, now + i * 0.3 + 0.16, 0.14, 0.15);
  }
}
