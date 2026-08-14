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
import type { AppUser } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(() => Boolean(auth && db));

  useEffect(() => {
    if (!auth || !db) {
      return;
    }
    const firestore = db;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (!firebaseUser) {
        setAppUser(null);
        setLoading(false);
        return;
      }

      const userDoc = await getDoc(doc(firestore, "users", firebaseUser.uid));

      if (!userDoc.exists()) {
        setAppUser(null);
        setLoading(false);
        return;
      }

      const data = userDoc.data();
      setAppUser({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: data.displayName ?? firebaseUser.email,
        role: data.role,
      });
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
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, appUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
