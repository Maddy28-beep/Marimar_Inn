"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PauseIcon, PlayIcon, SparklesIcon } from "lucide-react";

const ChristmasMotionContext = createContext({ motion: false, showSanta: true });
type MotionChoice = "system" | "on" | "off";
const MOTION_STORAGE_KEY = "marimar.christmas.motion";

/** Seasonal presentation only. No timers run while hidden or motion is disabled. */
export function ChristmasEffects({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<MotionChoice>("system");
  const choiceRef = useRef<MotionChoice>("system");
  const [canAnimate, setCanAnimate] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    function sync() {
      try {
        const saved = window.localStorage.getItem(MOTION_STORAGE_KEY);
        if (saved === "on" || saved === "off") choiceRef.current = saved;
      } catch {
        // The in-memory choice still works when storage is unavailable.
      }
      setChoice(choiceRef.current);
      setCanAnimate(
        document.visibilityState === "visible" &&
        (choiceRef.current === "on" || (choiceRef.current === "system" && !preference.matches))
      );
    }
    sync();
    if (preference.addEventListener) preference.addEventListener("change", sync);
    else preference.addListener(sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("storage", sync);
    return () => {
      if (preference.removeEventListener) preference.removeEventListener("change", sync);
      else preference.removeListener(sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const motion = canAnimate;
  function toggleMotion() {
    const next = motion ? "off" : "on";
    choiceRef.current = next;
    setChoice(next);
    setCanAnimate(next === "on" && document.visibilityState === "visible");
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, next);
    } catch {
      // The switch remains usable even in private/locked-down browser modes.
    }
  }
  return (
    <ChristmasMotionContext.Provider value={{ motion, showSanta: choice !== "off" }}>
      <div className="christmas-shell" data-festive-motion={motion ? "on" : "off"}>
        <div className="christmas-ribbon">
          <span className="christmas-ribbon-greeting"><SparklesIcon aria-hidden="true" /> Merry Christmas &amp; Happy Holidays!</span>
          <button type="button" className="christmas-motion-control" aria-label="Festive motion" aria-pressed={motion} onClick={toggleMotion}>
            {motion ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
            <span>{motion ? "Pause festive motion" : "Enable festive motion"}</span>
          </button>
        </div>
        <div className="christmas-snow" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => <i key={i} style={{ left: `${8 + i * 14}%`, animationDelay: `${i * -3}s`, animationDuration: `${22 + i * 2}s` }}>✦</i>)}
        </div>
        {children}
      </div>
    </ChristmasMotionContext.Provider>
  );
}

export function ChristmasGarland() {
  return <div className="christmas-garland" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} />)}</div>;
}

const SANTA_COMPANIONS = [
  { message: "Ho Ho Ho! Merry Christmas!", delay: "-6s" },
  { message: "Santa is checking the rooms!", delay: "-32s" },
  { message: "Merry Christmas from Marimar Inn!", delay: "-18s" },
];

/** Three immediately visible companions. CSS handles every step, without timers. */
export function SantaRunner() {
  const { showSanta } = useContext(ChristmasMotionContext);
  if (!showSanta) return null;

  return (
    <div className="santa-track" aria-hidden="true">
      {SANTA_COMPANIONS.map((santa) => (
        <div
          key={santa.message}
          className="santa-visit"
          style={{
            animationDelay: santa.delay,
          }}
        >
          <div className="santa-figure">
            <span className="santa-message">{santa.message}</span>
            <div className="santa-character" style={{ animationDelay: santa.delay }}>
              <span className="santa-trail">✦ · ❄ · ✧</span>
              <SantaCharacter />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SantaCharacter() {
  return (
          <svg viewBox="0 0 130 120" width="104" height="96" fill="none" focusable="false">
            <ellipse cx="67" cy="112" rx="33" ry="4" fill="#14532d" opacity=".12" />
            <path d="M35 39C8 34 7 72 29 79L51 69Z" fill="#9b7936" stroke="#7d6027" strokeWidth="2" />
            <path d="M27 40L39 34M26 37L32 30" stroke="#d4af37" strokeWidth="3" strokeLinecap="round" />
            <g className="santa-leg santa-leg-back"><path d="M57 84L47 99L34 102" stroke="#991b1b" strokeWidth="12" strokeLinecap="round" /><path d="M35 102L29 104" stroke="#24332c" strokeWidth="9" strokeLinecap="round" /></g>
            <g className="santa-leg santa-leg-front"><path d="M70 85L81 100L94 103" stroke="#b52a2a" strokeWidth="12" strokeLinecap="round" /><path d="M92 103L99 104" stroke="#24332c" strokeWidth="9" strokeLinecap="round" /></g>
            <g className="santa-body">
              <path d="M47 51C36 62 38 84 49 89H78C91 79 84 60 75 52Z" fill="#b52a2a" />
              <path d="M44 82H81" stroke="#fffdf5" strokeWidth="7" strokeLinecap="round" />
              <path d="M43 75H83" stroke="#24332c" strokeWidth="6" /><rect x="61" y="71" width="11" height="9" rx="1" stroke="#d4af37" strokeWidth="3" />
              <path d="M47 56L33 65L26 56" stroke="#991b1b" strokeWidth="10" strokeLinecap="round" /><circle cx="26" cy="54" r="5" fill="#f2c9a5" />
              <g className="santa-wave"><path d="M77 57L91 63L101 50" stroke="#b52a2a" strokeWidth="10" strokeLinecap="round" /><path d="M98 52L102 46" stroke="#fffdf5" strokeWidth="7" /><circle cx="105" cy="43" r="6" fill="#f2c9a5" /></g>
              <circle cx="65" cy="35" r="21" fill="#f2c9a5" />
              <path d="M44 32C39 51 52 65 67 61C82 58 87 45 83 36L75 43L66 45L56 42Z" fill="#fffdf5" />
              <path d="M43 24C45 8 62 4 72 11L91 25L75 22Z" fill="#b52a2a" />
              <path d="M44 25Q62 18 80 27" stroke="#fffdf5" strokeWidth="8" strokeLinecap="round" /><circle cx="93" cy="26" r="6" fill="#fffdf5" />
              <circle cx="60" cy="33" r="1.8" fill="#24332c" /><circle cx="74" cy="33" r="1.8" fill="#24332c" />
              <ellipse cx="69" cy="39" rx="5" ry="3.5" fill="#e8a78b" /><path d="M64 48Q69 52 74 47" stroke="#991b1b" strokeWidth="1.8" strokeLinecap="round" />
            </g>
          </svg>
  );
}
