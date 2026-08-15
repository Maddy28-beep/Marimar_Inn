import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_RATE_PACKAGES, type RatePackage, type Room, type RoomStatus, type RoomType } from "@/lib/types";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export function subscribeToRooms(onChange: (rooms: Room[]) => void) {
  const firestore = requireDb();
  const q = query(collection(firestore, "rooms"));
  return onSnapshot(q, (snapshot) => {
    const rooms = snapshot.docs.map(
      (d) => d.data({ serverTimestamps: "estimate" }) as Room
    );
    // roomNumber is a string ("1".."17"), so a plain string sort would put
    // "10" before "2" — sort numerically so room order matches guest-facing order.
    rooms.sort((a, b) => Number(a.roomNumber) - Number(b.roomNumber));
    onChange(rooms);
  });
}

export interface NewRoomInput {
  roomNumber: string;
  floor: number;
  type: RoomType;
}

export async function createRoom(input: NewRoomInput) {
  const firestore = requireDb();
  const ref = doc(collection(firestore, "rooms"));
  const room: Omit<Room, "lastUpdated"> & { lastUpdated: ReturnType<typeof serverTimestamp> } = {
    roomId: ref.id,
    roomNumber: input.roomNumber,
    floor: input.floor,
    type: input.type,
    status: "available",
    lastUpdated: serverTimestamp(),
  };
  await setDoc(ref, room);
}

export async function updateRoom(roomId: string, input: NewRoomInput) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "rooms", roomId), {
    roomNumber: input.roomNumber,
    floor: input.floor,
    type: input.type,
  });
}

export async function updateRoomStatus(roomId: string, status: RoomStatus) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "rooms", roomId), {
    status,
    lastUpdated: serverTimestamp(),
  });
}

export async function deleteRoom(roomId: string) {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "rooms", roomId));
}

interface SeedRoomSpec {
  roomNumber: string;
  floor: number;
  type: RoomType;
}

function buildSeedRooms(): SeedRoomSpec[] {
  // 17 standard rooms — the inn's actual current room count, numbered 1-17
  return Array.from({ length: 17 }, (_, index) => ({
    roomNumber: String(index + 1),
    floor: 1,
    type: "standard" as const,
  }));
}

export async function seedInitialRooms() {
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  const rooms = buildSeedRooms();

  for (const spec of rooms) {
    const ref = doc(collection(firestore, "rooms"));
    const room: Omit<Room, "lastUpdated"> & { lastUpdated: ReturnType<typeof serverTimestamp> } = {
      roomId: ref.id,
      roomNumber: spec.roomNumber,
      floor: spec.floor,
      type: spec.type,
      status: "available",
      lastUpdated: serverTimestamp(),
    };
    batch.set(ref, room);
  }

  await batch.commit();
}

export function subscribeToRatePackages(onChange: (packages: RatePackage[]) => void) {
  const firestore = requireDb();
  const q = query(collection(firestore, "ratePackages"));
  return onSnapshot(q, (snapshot) => {
    const packages = snapshot.docs.map(
      (d) => d.data({ serverTimestamps: "estimate" }) as RatePackage
    );
    packages.sort((a, b) => a.hours - b.hours);
    onChange(packages);
  });
}

export interface RatePackageInput {
  hours: number;
  price: number;
}

export async function createRatePackage(input: RatePackageInput) {
  const firestore = requireDb();
  const ref = doc(collection(firestore, "ratePackages"));
  const pkg: RatePackage = { packageId: ref.id, hours: input.hours, price: input.price };
  await setDoc(ref, pkg);
}

export async function updateRatePackage(packageId: string, input: RatePackageInput) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "ratePackages", packageId), {
    hours: input.hours,
    price: input.price,
  });
}

export async function deleteRatePackage(packageId: string) {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "ratePackages", packageId));
}

export async function seedDefaultRatePackages() {
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  for (const spec of DEFAULT_RATE_PACKAGES) {
    const ref = doc(collection(firestore, "ratePackages"));
    const pkg: RatePackage = { packageId: ref.id, hours: spec.hours, price: spec.price };
    batch.set(ref, pkg);
  }
  await batch.commit();
}
