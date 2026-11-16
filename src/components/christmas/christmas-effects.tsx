"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PauseIcon, PlayIcon, SparklesIcon } from "lucide-react";

const ChristmasMotionContext = createContext(false);

/** Seasonal presentation only. No timers run while hidden or motion is disabled. */
export function ChristmasEffects({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [canAnimate, setCanAnimate] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    function sync() {
      setCanAnimate(!preference.matches && document.visibilityState === "visible");
    }
    sync();
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const motion = canAnimate && !paused;
  return (
    <ChristmasMotionContext.Provider value={motion}>
      <div className="christmas-shell" data-festive-motion={motion ? "on" : "off"}>
        <div className="christmas-ribbon">
          <span className="christmas-ribbon-greeting"><SparklesIcon aria-hidden="true" /> Merry Christmas &amp; Happy Holidays!</span>
          <button type="button" className="christmas-motion-control" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
            <span>{paused ? "Enable festive motion" : "Pause festive motion"}</span>
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

const MESSAGES = [
  "Ho Ho Ho! Merry Christmas!",
  "Santa is checking the rooms!",
  "Merry Christmas from Marimar Inn!",
  "Santa approved this room! 🎁",
];

/** One small SVG, animated only during a visit; no frame loops or dependencies. */
export function SantaRunner() {
  const motion = useContext(ChristmasMotionContext);
  const [visit, setVisit] = useState<{ message: string; reverse: boolean } | null>(null);

  useEffect(() => {
    if (!motion) return;
    let timer: ReturnType<typeof setTimeout>;
    let finished = false;
    function schedule(delay: number) {
      timer = setTimeout(() => {
        if (finished) return;
        setVisit({ message: MESSAGES[Math.floor(Math.random() * MESSAGES.length)], reverse: Math.random() < 0.35 });
        timer = setTimeout(() => {
          setVisit(null);
          schedule(65_000 + Math.random() * 50_000);
        }, 18_000);
      }, delay);
    }
    schedule(9_000 + Math.random() * 6_000);
    return () => {
      finished = true;
      clearTimeout(timer);
      setVisit(null);
    };
  }, [motion]);

  if (!motion || !visit) return null;
  return (
    <div className="santa-track" aria-hidden="true">
      <div className={`santa-visit${visit.reverse ? " santa-reverse" : ""}`}>
        <div className="santa-figure">
        <span className="santa-message">{visit.message}</span>
        <div className="santa-character">
          <span className="santa-trail">✦ · ❄ · ✧</span>
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
        </div>
        </div>
      </div>
    </div>
  );
}
