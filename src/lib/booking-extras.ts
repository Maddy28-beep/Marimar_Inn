import {
  AMENITY_BLANKET_ID,
  AMENITY_TOWEL_ID,
  BLANKET_FEE,
  EXTRA_PERSON_FEE,
  TOWEL_FEE,
  type Booking,
  type OrderItem,
} from "@/lib/types";

function amenityQty(items: OrderItem[] | undefined, itemId: string): number {
  return (items ?? [])
    .filter((item) => item.itemId === itemId)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function amenitySubtotal(
  items: OrderItem[] | undefined,
  itemId: string,
  fallbackQty: number,
  fee: number
): number {
  const lines = (items ?? []).filter((item) => item.itemId === itemId);
  if (lines.length > 0) return lines.reduce((sum, item) => sum + item.subtotal, 0);
  return fallbackQty * fee;
}

export function isAmenityItem(item: OrderItem): boolean {
  return item.itemId === AMENITY_TOWEL_ID || item.itemId === AMENITY_BLANKET_ID;
}

/**
 * Label covering only towels/blankets (real physical products), leaving out
 * the extra-person fee — used where the room charge itself is excluded
 * (e.g. a voided booking) so the label doesn't reference a room-only fee
 * that isn't being shown as revenue.
 */
export function amenityOnlyLabel(extras: Pick<BookingExtras, "towels" | "blankets">): string {
  const parts: string[] = [];
  if (extras.towels > 0) parts.push(`${extras.towels} towel${extras.towels === 1 ? "" : "s"}`);
  if (extras.blankets > 0) parts.push(`${extras.blankets} blanket${extras.blankets === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export interface BookingExtras {
  extraPersons: number;
  towels: number;
  blankets: number;
  extraPersonAmount: number;
  towelAmount: number;
  blanketAmount: number;
  amenityAmount: number;
  extrasAmount: number;
  extrasLabel: string;
}

export function bookingExtras(
  booking: Pick<Booking, "extraPersonCount" | "towelCount" | "blanketCount" | "items">
): BookingExtras {
  const extraPersons = Math.max(0, Math.floor(booking.extraPersonCount ?? 0));
  const towels = Math.max(0, Math.floor(booking.towelCount ?? amenityQty(booking.items, AMENITY_TOWEL_ID)));
  const blankets = Math.max(
    0,
    Math.floor(booking.blanketCount ?? amenityQty(booking.items, AMENITY_BLANKET_ID))
  );
  const extraPersonAmount = extraPersons * EXTRA_PERSON_FEE;
  const towelAmount = amenitySubtotal(booking.items, AMENITY_TOWEL_ID, towels, TOWEL_FEE);
  const blanketAmount = amenitySubtotal(booking.items, AMENITY_BLANKET_ID, blankets, BLANKET_FEE);
  const amenityAmount = towelAmount + blanketAmount;
  const extrasAmount = extraPersonAmount + amenityAmount;
  const parts: string[] = [];
  if (extraPersons > 0) parts.push(`${extraPersons} extra person`);
  if (towels > 0) parts.push(`${towels} towel${towels === 1 ? "" : "s"}`);
  if (blankets > 0) parts.push(`${blankets} blanket${blankets === 1 ? "" : "s"}`);

  return {
    extraPersons,
    towels,
    blankets,
    extraPersonAmount,
    towelAmount,
    blanketAmount,
    amenityAmount,
    extrasAmount,
    extrasLabel: parts.join(", "),
  };
}
