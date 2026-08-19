import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

const DRAWER_DOC_ID = "cashDrawer";

/**
 * Keep only 0–9, including full-width / Arabic-Indic digits some tablet
 * keyboards insert. Spaces and password-manager junk get stripped so "2026"
 * is what actually gets saved and checked.
 */
export function normalizePin(pin: string): string {
  return Array.from(pin.normalize("NFKC"))
    .map((ch) => {
      const n = ch.codePointAt(0)!;
      if (n >= 0x30 && n <= 0x39) return ch;
      if (n >= 0xff10 && n <= 0xff19) return String(n - 0xff10);
      if (n >= 0x0660 && n <= 0x0669) return String(n - 0x0660);
      if (n >= 0x06f0 && n <= 0x06f9) return String(n - 0x06f0);
      return "";
    })
    .join("");
}

/**
 * SHA-256 via the Web Crypto API — the PIN itself never touches Firestore,
 * only its hash. This isn't meant to withstand a determined attacker (a
 * short numeric PIN has a small keyspace), just to stop a cashier from
 * opening the drawer without the code the Owner actually gave them.
 */
async function hashPin(pin: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("This device can't check a PIN. Open Chrome, or update the tablet app.");
  }
  const data = new TextEncoder().encode(pin);
  const digest = await subtle.digest({ name: "SHA-256" }, data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function setDrawerPin(pin: string) {
  const digits = normalizePin(pin);
  if (digits.length < 4) {
    throw new Error("Use at least 4 digits.");
  }
  const firestore = requireDb();
  const pinHash = await hashPin(digits);
  await setDoc(doc(firestore, "settings", DRAWER_DOC_ID), { pinHash }, { merge: true });
}

export async function verifyDrawerPin(pin: string): Promise<boolean> {
  const firestore = requireDb();
  const snap = await getDoc(doc(firestore, "settings", DRAWER_DOC_ID));
  if (!snap.exists()) return false;
  const stored = String(snap.data().pinHash ?? "")
    .trim()
    .toLowerCase();
  if (!stored) return false;

  const candidates = [...new Set([normalizePin(pin), pin.trim()].filter(Boolean))];
  for (const candidate of candidates) {
    const hashed = (await hashPin(candidate)).toLowerCase();
    if (hashed === stored) return true;
  }
  return false;
}

export function subscribeToDrawerPinConfigured(onChange: (configured: boolean) => void) {
  const firestore = requireDb();
  return onSnapshot(
    doc(firestore, "settings", DRAWER_DOC_ID),
    (snap) => {
      onChange(snap.exists() && !!snap.data()?.pinHash);
    },
    () => {
      onChange(false);
    }
  );
}
