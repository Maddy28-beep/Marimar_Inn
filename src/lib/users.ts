import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db, createUserOnSecondaryApp } from "@/lib/firebase";
import type { UserRole } from "@/lib/types";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export interface StaffUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export function subscribeToUsers(onChange: (users: StaffUser[]) => void) {
  const firestore = requireDb();
  return onSnapshot(collection(firestore, "users"), (snapshot) => {
    onChange(
      snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          email: data.email,
          displayName: data.displayName,
          role: data.role,
        };
      })
    );
  });
}

export interface CreateStaffInput {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
}

export async function createStaffUser(input: CreateStaffInput) {
  const firestore = requireDb();
  const uid = await createUserOnSecondaryApp(input.email, input.password);

  await setDoc(doc(firestore, "users", uid), {
    role: input.role,
    displayName: input.displayName,
    email: input.email,
    createdAt: serverTimestamp(),
  });

  return uid;
}
