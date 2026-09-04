import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, signOut, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

// Only touch the Firebase SDK when real config is present — getAuth() eagerly
// makes a network call that throws an unhandled rejection on a bad API key,
// which would otherwise crash the app before .env.local is filled in.
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  const app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Persistent (IndexedDB-backed) offline cache — the front desk runs on a
  // single tablet with occasional multi-hour internet outages, and needs to
  // keep checking guests in/out and taking payments through them. This is
  // what lets every onSnapshot listener keep serving from cache and every
  // plain write (setDoc/updateDoc/writeBatch) queue locally and flush once
  // reconnected. persistentMultipleTabManager covers the case where staff
  // open the app in a second browser tab on the same tablet — not a
  // multi-device scenario, just cheap insurance.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // initializeFirestore() can only run once per app instance — a dev-mode
    // hot reload of this module re-executes it against the same already-
    // initialized app and throws. Fall back to the existing instance rather
    // than crashing; the persistence config from the first run still stands.
    db = getFirestore(app);
  }
}

export { auth, db };

/**
 * A second, independent Firebase app instance used only for creating new
 * staff Auth accounts. `createUserWithEmailAndPassword` signs in as the
 * newly-created user on whatever auth instance it's called against — running
 * it on a secondary instance keeps the Owner's own session on the primary
 * `auth` untouched.
 */
export async function createUserOnSecondaryApp(email: string, password: string) {
  if (!isFirebaseConfigured) throw new Error("Firebase isn't configured.");
  const { createUserWithEmailAndPassword } = await import("firebase/auth");

  const secondaryApp =
    getApps().find((a) => a.name === "secondary") ??
    initializeApp(firebaseConfig, "secondary");
  const secondaryAuth = getAuth(secondaryApp);

  const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  const uid = credential.user.uid;
  await signOut(secondaryAuth);
  return uid;
}
