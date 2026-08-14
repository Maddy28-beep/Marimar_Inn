import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, signOut, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

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
  db = getFirestore(app);
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
