import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

const DRAWER_DOC_ID = "cashDrawer";

/**
 * SHA-256 via the Web Crypto API — the PIN itself never touches Firestore,
 * only its hash. This isn't meant to withstand a determined attacker (a
 * short numeric PIN has a small keyspace), just to stop a cashier from
 * opening the drawer without the code the Owner actually gave them.
 */
async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function setDrawerPin(pin: string) {
  const firestore = requireDb();
  const pinHash = await hashPin(pin);
  await setDoc(doc(firestore, "settings", DRAWER_DOC_ID), { pinHash });
}

export async function verifyDrawerPin(pin: string): Promise<boolean> {
  const firestore = requireDb();
  const snap = await getDoc(doc(firestore, "settings", DRAWER_DOC_ID));
  if (!snap.exists()) return false;
  const stored = snap.data().pinHash as string | undefined;
  if (!stored) return false;
  return (await hashPin(pin)) === stored;
}

export function subscribeToDrawerPinConfigured(onChange: (configured: boolean) => void) {
  const firestore = requireDb();
  return onSnapshot(doc(firestore, "settings", DRAWER_DOC_ID), (snap) => {
    onChange(snap.exists() && !!snap.data()?.pinHash);
  });
}
