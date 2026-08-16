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
 *
 * On WebKit (Safari, and Chrome/any browser on iOS — Apple requires all iOS
 * browsers to use WebKit under the hood) just resuming the context isn't
 * always enough to unlock it for sounds triggered later, asynchronously
 * (e.g. from a Firestore listener) — the audio session only fully unlocks
 * once a real sound node has actually started playing inside the gesture.
 * So this schedules one, at a gain low enough to be inaudible.
 */
export function primeAlarmAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  beep(ctx, 440, ctx.currentTime, 0.05, 0.0001);
}

/**
 * Re-attempts resuming a previously-unlocked context after the tab/screen
 * comes back from being backgrounded — iOS suspends the AudioContext when
 * the screen locks or the browser goes to the background, and won't resume
 * it on its own even once the app is visible again.
 */
export function resumeAlarmAudio() {
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

/** Sharper double chime — used once when a room drops to 15 minutes left. */
export function playCriticalChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  beep(ctx, 880, now, 0.18, 0.16);
  beep(ctx, 880, now + 0.24, 0.18, 0.16);
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
