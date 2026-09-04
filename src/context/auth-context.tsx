"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { AppUser, UserRole } from "@/lib/types";

const APP_USER_CACHE_KEY = "marimar-app-user";
const DEACTIVATED_NOTICE_KEY = "marimar-deactivated-notice";
const USER_ROLES = new Set<UserRole>(["owner", "admin", "superadmin", "supervisor", "cashier"]);

interface AuthContextValue {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readCachedAppUser(): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(APP_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppUser>;
    if (
      typeof parsed.uid !== "string" ||
      !USER_ROLES.has(parsed.role as UserRole)
    ) {
      return null;
    }
    return {
      uid: parsed.uid,
      email: typeof parsed.email === "string" ? parsed.email : null,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : null,
      role: parsed.role as UserRole,
    };
  } catch {
    return null;
  }
}

function cacheAppUser(appUser: AppUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (appUser) {
      window.sessionStorage.setItem(APP_USER_CACHE_KEY, JSON.stringify(appUser));
    } else {
      window.sessionStorage.removeItem(APP_USER_CACHE_KEY);
    }
  } catch {
    // Some locked-down browser modes disable sessionStorage.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(() => readCachedAppUser());
  const [loading, setLoading] = useState(() => Boolean(auth && db));

  useEffect(() => {
    if (!auth || !db) {
      return;
    }
    const firestore = db;
    const authInstance = auth;

    const unsubscribe = onAuthStateChanged(authInstance, async (firebaseUser) => {
      setUser(firebaseUser);

      if (!firebaseUser) {
        setAppUser(null);
        cacheAppUser(null);
        setLoading(false);
        return;
      }

      let userDoc;
      try {
        userDoc = await getDoc(doc(firestore, "users", firebaseUser.uid));
      } catch {
        // Offline with nothing cached yet for this doc (e.g. a fresh page
        // load with no network) — getDoc() throws instead of the usual
        // fromCache:true fallback. Fall back to whatever role/name was
        // cached from the last successful sign-in on this device rather
        // than hanging on the loading screen forever. This means a role
        // change or deactivation made elsewhere won't take effect on this
        // device until it's back online and gets a fresh read — an
        // accepted tradeoff for a single-tablet deployment, and it
        // self-corrects the next time this listener runs with connectivity.
        const cached = readCachedAppUser();
        if (cached && cached.uid === firebaseUser.uid) {
          setAppUser(cached);
          setLoading(false);
          return;
        }
        setAppUser(null);
        cacheAppUser(null);
        setLoading(false);
        return;
      }

      if (!userDoc.exists()) {
        setAppUser(null);
        cacheAppUser(null);
        setLoading(false);
        return;
      }

      const data = userDoc.data();

      // Deactivated accounts keep their doc (role intact, reversible) but
      // can't use the app — end the session outright rather than leaving
      // them signed into Firebase Auth with nowhere to go, and leave a
      // marker so the login page can explain why they got bounced.
      if (data.active === false) {
        setAppUser(null);
        cacheAppUser(null);
        setLoading(false);
        try {
          window.sessionStorage.setItem(DEACTIVATED_NOTICE_KEY, "1");
        } catch {
          // Some locked-down browser modes disable sessionStorage.
        }
        await firebaseSignOut(authInstance);
        return;
      }

      const nextAppUser: AppUser = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: data.displayName ?? firebaseUser.email,
        role: data.role,
      };
      setAppUser(nextAppUser);
      cacheAppUser(nextAppUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  async function signIn(email: string, password: string) {
    if (!auth) {
      throw new Error(
        "Firebase isn't configured yet — add your project's values to .env.local (see README)."
      );
    }
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function signOut() {
    if (!auth) return;
    cacheAppUser(null);
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, appUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Reads and clears the "you were signed out because this account was
 * deactivated" marker — one-shot so it only shows once, right after the
 * forced sign-out lands the user back on /login.
 */
export function consumeDeactivatedNotice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const flagged = window.sessionStorage.getItem(DEACTIVATED_NOTICE_KEY) === "1";
    if (flagged) window.sessionStorage.removeItem(DEACTIVATED_NOTICE_KEY);
    return flagged;
  } catch {
    return false;
  }
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
