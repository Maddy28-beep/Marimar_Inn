import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth, db, createUserOnSecondaryApp } from "@/lib/firebase";
import type { UserRole } from "@/lib/types";
import { isHiddenSuperadminEmail, reservedRoleForStaff } from "@/lib/roles";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export interface StaffUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  // Absent/true = active — see AppUser.active in types.ts.
  active?: boolean;
}

export function subscribeToUsers(onChange: (users: StaffUser[]) => void) {
  const firestore = requireDb();
  // A collection listener with no orderBy has no guaranteed row order —
  // Firestore can reshuffle the snapshot on any write, even to an
  // unrelated field on one doc, which made the Manage Staff table
  // visually shuffle rows around after every edit/deactivate/etc. and
  // made it look like actions weren't taking effect.
  const q = query(collection(firestore, "users"), orderBy("displayName"));
  return onSnapshot(q, (snapshot) => {
    const users = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          email: data.email,
          displayName: data.displayName,
          role: data.role,
          active: data.active,
        };
      });
    void syncReservedStaffRoles(users);
    onChange(users.filter((user) => !isHiddenSuperadminEmail(user.email)));
  });
}

async function syncReservedStaffRoles(users: StaffUser[]) {
  const firestore = requireDb();
  await Promise.all(
    users.map(async (user) => {
      const reservedRole = reservedRoleForStaff(user.displayName, user.email);
      if (!reservedRole || user.role === reservedRole) return;
      try {
        await updateDoc(doc(firestore, "users", user.uid), { role: reservedRole });
      } catch {
        // Only owner-like users can change roles; other staff may subscribe here too.
      }
    })
  );
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

export interface UpdateStaffInput {
  displayName: string;
  role: UserRole;
}

/**
 * Updates a staff member's name/role. Email is intentionally not editable
 * here — it's the Firebase Auth login identity, and the client SDK can't
 * change another user's Auth email without them being signed in themselves
 * (same constraint documented on resetStaffPassword below). If an email is
 * genuinely wrong, delete and recreate the account instead.
 */
export async function updateStaffUser(uid: string, input: UpdateStaffInput) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "users", uid), {
    displayName: input.displayName,
    role: input.role,
  });
}

/**
 * Deactivating keeps the account and its role intact but blocks sign-in
 * (see AuthContext) — reversible, unlike delete. Reactivating just flips
 * the flag back.
 */
export async function setStaffActive(uid: string, active: boolean) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "users", uid), { active });
}

/**
 * Removes the staff member's `users/{uid}` doc. This is a client-SDK-only
 * app with no backend/Admin SDK, so it can't delete the underlying Firebase
 * Auth account for someone other than whoever is currently signed in — but
 * `AuthContext` treats a missing user doc as "no access" (see
 * `auth-context.tsx`), so this fully locks the account out of the app, which
 * is what "delete" means in practice here.
 */
export async function deleteStaffUser(uid: string) {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "users", uid));
}

/**
 * Sends the standard Firebase "reset your password" email — the only
 * password-reset path available without a backend/Admin SDK, since the
 * client SDK can't set another user's password directly. The staff member
 * follows the emailed link to choose a new password themselves.
 */
export async function resetStaffPassword(email: string) {
  if (!auth) throw new Error("Firebase isn't configured.");
  await sendPasswordResetEmail(auth, email);
}
