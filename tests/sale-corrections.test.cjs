/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner with a TypeScript application loader. */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, Timestamp, writeBatch } = require("firebase/firestore");

// This suite can only run against the named local emulator, never production.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8188");
const root = path.resolve(__dirname, "..");
const backend = { db: null, auth: { currentUser: { uid: "owner-1" } } };
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "@/lib/firebase") return backend;
  // Reports only need the receipt reference helper, not a physical printer.
  if (request === "@point-of-sale/webserial-receipt-printer") return class TestPrinter {};
  return originalLoad.call(this, request, parent, ...rest);
};
require.extensions[".ts"] = (mod, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  mod._compile(code, filename);
};

const { correctHistoricalSale } = require("../src/lib/sale-corrections.ts");
const { planSaleCorrection, canCorrectSale, effectivePaymentEvents } = require("../src/lib/sale-correction-plan.ts");
const { computeDailySalesReport, computeShiftCollectedTotals, computeMonthlyReport } = require("../src/lib/reports.ts");
const { fetchPaymentEvents, changeBookingPaymentMethod } = require("../src/lib/payment-changes.ts");
const { setActiveBranchId } = require("../src/lib/branches.ts");
let env;
const checkIn = Timestamp.fromDate(new Date("2026-11-28T04:48:00+08:00"));
const extendedAt = Timestamp.fromDate(new Date("2026-11-28T06:50:00+08:00"));
const updatedAt = Timestamp.fromDate(new Date("2026-11-28T07:55:00+08:00"));
function booking(overrides = {}) {
  return { bookingId: "VQSI-XKQM", roomId: "room-9", roomNumber: "9", guestName: "Test guest", checkInTime: checkIn, checkOutTime: updatedAt,
    hoursBooked: 6, originalPackageHours: 3, originalPackagePrice: 200, totalRoomCharge: 400, totalFbCharge: 0, totalAmount: 400,
    amountPaid: 400, paymentMethod: "cash", splitCashAmount: 400, splitGcashAmount: 0, splitQrphAmount: 0,
    paymentStatus: "paid", status: "checked_out", items: [], cashierId: "cashier-1", cashierName: "Cashier", updatedAt, ...overrides };
}
function payment(id, type, amount, timestamp, extra = {}) {
  return { transactionId: id, type, bookingId: "VQSI-XKQM", roomNumber: "9", amount, cashAmount: amount, gcashAmount: 0, qrphAmount: 0, cashierId: "cashier-1", cashierName: "Cashier", timestamp, ...extra };
}
const extensionInput = (overrides = {}) => ({ action: "extension", extensionHours: 0, extensionAmount: 0, removePayment: { cash: 200, gcash: 0, qrph: 0 }, reason: "Cashier accidentally added the extension; only 200 was collected.", expectedUpdatedAt: updatedAt.toMillis(), expectedCorrectionCount: 0, ...overrides });
const prefix = (branch) => branch === "marimar-1" ? "" : `branches/${branch}/`;
const actor = { uid: "owner-1", name: "Owner", role: "owner" };
async function seed(branch = "marimar-1", value = booking(), payments = [payment("checkin-1", "checkin", 200, checkIn), payment("extend-1", "extend", 200, extendedAt)]) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, `${prefix(branch)}bookings/${value.bookingId}`), value);
    batch.set(doc(db, `${prefix(branch)}rooms/room-9`), { roomId: "room-9", roomNumber: "9", status: "occupied", lastUpdated: updatedAt });
    payments.forEach(p => batch.set(doc(db, `${prefix(branch)}transactions/${p.transactionId}`), p));
    await batch.commit();
  });
}
async function readBooking(branch = "marimar-1") { return (await getDoc(doc(backend.db, `${prefix(branch)}bookings/VQSI-XKQM`))).data(); }
async function readPayments(branch = "marimar-1") { return (await getDocs(query(collection(backend.db, `${prefix(branch)}transactions`), where("bookingId", "==", "VQSI-XKQM")))).docs.map(d => d.data()); }

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-marimar-corrections", firestore: { host: "127.0.0.1", port: 8188, rules: fs.readFileSync(path.join(root, "firestore.rules"), "utf8") } });
});
beforeEach(async () => {
  await env.clearFirestore();
  backend.db = env.authenticatedContext("owner-1").firestore();
  backend.auth.currentUser = { uid: "owner-1" };
  setActiveBranchId("marimar-1");
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, role] of [["owner-1", "owner"], ["cashier-1", "cashier"], ["supervisor-1", "supervisor"]]) {
      await setDoc(doc(context.firestore(), "users", uid), { role, displayName: role, email: `${role}@example.test`, active: true });
    }
  });
});
after(async () => { await env?.cleanup(); });

test("VQSI-XKQM: remove 3h / 200 after checkout; rows, shift cash and monthly revenue become 200", async () => {
  await seed();
  await correctHistoricalSale("VQSI-XKQM", extensionInput());
  const current = await readBooking();
  assert.equal(current.hoursBooked, 3);
  assert.equal(current.totalAmount, 200);
  assert.equal(current.amountPaid, 200);
  assert.equal(current.splitCashAmount, 200);
  assert.equal(current.status, "checked_out");
  assert(current.checkOutTime.isEqual(updatedAt));
  const report = computeDailySalesReport([current]);
  assert.equal(report.rows[0].extensionHours, 0);
  assert.equal(report.rows[0].extensionAmount, 0);
  assert.equal(report.totals.totalPaid, 200);
  assert.equal(computeShiftCollectedTotals(await readPayments(), [], [current]).totalCollected, 200);
  assert.equal(computeMonthlyReport([current], [], new Date("2026-11-01")).totalRevenue, 200);
  const audit = (await getDocs(collection(backend.db, "saleCorrections"))).docs[0].data();
  assert.equal(audit.before.totalAmount, 400);
  assert.equal(audit.after.totalAmount, 200);
  assert.equal(audit.correctedBy, "owner-1");
  assert(audit.recordedAt.toMillis() > checkIn.toMillis());
  assert(audit.removedPayments[0].timestamp.isEqual(extendedAt));
  assert.equal((await getDoc(doc(backend.db, "rooms/room-9"))).data().status, "occupied");
});

test("Marimar 2 correction leaves the same booking in Marimar 1 untouched", async () => {
  await seed(); await seed("marimar-2");
  await correctHistoricalSale("VQSI-XKQM", extensionInput(), "marimar-2");
  assert.equal((await readBooking("marimar-1")).totalAmount, 400);
  assert.equal((await readBooking("marimar-2")).totalAmount, 200);
  assert.equal((await getDocs(collection(backend.db, "saleCorrections"))).size, 0);
  assert.equal((await getDocs(collection(backend.db, "branches/marimar-2/saleCorrections"))).size, 1);
});

test("a cross-shift extension is removed from its collection shift, not the correction date", async () => {
  const dayPayment = Timestamp.fromDate(new Date("2026-11-28T07:49:00+08:00"));
  await seed("marimar-1", booking(), [payment("checkin-1", "checkin", 200, checkIn), payment("extend-1", "extend", 200, dayPayment)]);
  await correctHistoricalSale("VQSI-XKQM", extensionInput());
  const payments = await readPayments();
  const night = payments.filter(p => p.timestamp.toMillis() < new Date("2026-11-28T07:00:00+08:00").getTime());
  const day = payments.filter(p => !night.includes(p));
  assert.equal(computeShiftCollectedTotals(night, []).cashCollected, 200);
  assert.equal(computeShiftCollectedTotals(day, []).cashCollected, 0);
  assert(payments.find(p => p.type === "sale_correction").timestamp.isEqual(dayPayment));
});

test("mixed methods and earlier method corrections reverse the current wallet correctly", async () => {
  const value = booking({ paymentMethod: "split", splitCashAmount: 200, splitGcashAmount: 200 });
  await seed("marimar-1", value, [payment("checkin-1", "checkin", 200, checkIn), payment("extend-1", "extend", 200, extendedAt),
    payment("method-1", "method_change", 0, extendedAt, { correctsTransactionId: "extend-1", cashAmount: -200, gcashAmount: 200 })]);
  await correctHistoricalSale("VQSI-XKQM", extensionInput({ removePayment: { cash: 0, gcash: 200, qrph: 0 } }));
  const current = await readBooking();
  assert.equal(current.splitCashAmount, 200); assert.equal(current.splitGcashAmount, 0);
  assert.equal(computeShiftCollectedTotals(await readPayments(), []).totalCollected, 200);
  assert.equal((await fetchPaymentEvents("VQSI-XKQM")).length, 1);
  await changeBookingPaymentMethod("VQSI-XKQM", "checkin-1", { cash: 0, gcash: 0, qrph: 200, qrphReference: "TEST-QR" }, actor);
  assert.equal((await readBooking()).splitQrphAmount, 200);
  const events = await fetchPaymentEvents("VQSI-XKQM");
  assert.equal(events[0].amount, 200); assert.equal(events[0].split.qrph, 200);
});

test("a partial paid extension can remove the charge while retaining real collections", async () => {
  await seed("marimar-1", booking({ amountPaid: 300, splitCashAmount: 300, paymentStatus: "partial" }), [payment("checkin-1", "checkin", 200, checkIn), payment("extend-1", "extend", 100, extendedAt)]);
  await correctHistoricalSale("VQSI-XKQM", extensionInput({ removePayment: { cash: 100, gcash: 0, qrph: 0 } }));
  assert.equal((await readBooking()).amountPaid, 200);
  assert.equal(computeShiftCollectedTotals(await readPayments(), []).cashCollected, 200);
});

test("extension correction preserves extra-person charges, amenities and store items", async () => {
  const items = [{ itemId: "water", name: "Water", unitPrice: 15, quantity: 2, subtotal: 30 }, { itemId: "amenity-towel", name: "Towel", unitPrice: 20, quantity: 1, subtotal: 20 }];
  await seed("marimar-1", booking({ hoursBooked: 4, extraPersonCount: 1, towelCount: 1, items, totalRoomCharge: 400, totalFbCharge: 50, totalAmount: 450, amountPaid: 450, splitCashAmount: 450 }), [payment("checkin-1", "checkin", 350, checkIn), payment("extend-1", "extend", 100, extendedAt)]);
  await correctHistoricalSale("VQSI-XKQM", extensionInput({ removePayment: { cash: 100, gcash: 0, qrph: 0 } }));
  const current = await readBooking();
  assert.equal(current.totalAmount, 350); assert.deepEqual(current.items, items);
  const row = computeDailySalesReport([current]).rows[0];
  assert.equal(row.packageAmount, 200); assert.equal(row.extrasAmount, 120); assert.equal(row.totalStoreAmount, 30); assert.equal(row.extensionAmount, 0);
});

test("removing a wrong charge does not erase money that was actually collected", async () => {
  await seed();
  await correctHistoricalSale("VQSI-XKQM", extensionInput({ removePayment: { cash: 0, gcash: 0, qrph: 0 } }));
  const current = await readBooking();
  assert.equal(current.totalAmount, 200); assert.equal(current.amountPaid, 400);
  assert.equal(computeShiftCollectedTotals(await readPayments(), []).cashCollected, 400);
});

test("duplicate removal after checkout reverses all payments and restores stock once without touching the current room", async () => {
  const value = booking({ items: [{ itemId: "water", name: "Water", unitPrice: 15, quantity: 2, subtotal: 30 }], totalFbCharge: 30, totalAmount: 430, amountPaid: 430, splitCashAmount: 430 });
  await seed("marimar-1", value, [payment("checkin-1", "checkin", 200, checkIn), payment("extend-1", "extend", 200, extendedAt), payment("order-1", "order", 30, extendedAt)]);
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "inventory/water"), { itemId: "water", quantity: 5, piecesPerSale: 3, minStockLevel: 10 });
    await setDoc(doc(context.firestore(), "notifications/low-stock-water"), { resolved: false });
  });
  await correctHistoricalSale("VQSI-XKQM", extensionInput({ action: "duplicate", restoreStock: true }));
  const current = await readBooking();
  assert.equal(current.status, "voided"); assert.equal(current.amountPaid, 0);
  assert.equal(computeDailySalesReport([current]).rows.length, 0);
  assert.equal(computeShiftCollectedTotals(await readPayments(), []).totalCollected, 0);
  assert.equal((await getDoc(doc(backend.db, "inventory/water"))).data().quantity, 11);
  assert.equal((await getDoc(doc(backend.db, "notifications/low-stock-water"))).data().resolved, true);
  assert.equal((await getDoc(doc(backend.db, "rooms/room-9"))).data().status, "occupied");
  await assert.rejects(correctHistoricalSale("VQSI-XKQM", extensionInput({ action: "duplicate" })), /already.*duplicate/);
  assert.equal((await getDoc(doc(backend.db, "inventory/water"))).data().quantity, 11);
});

test("duplicate removal can retain delivered stock when the owner unchecks restoration", async () => {
  const value = booking({ items: [{ itemId: "water", name: "Water", unitPrice: 15, quantity: 2, subtotal: 30 }], totalFbCharge: 30, totalAmount: 430, amountPaid: 430, splitCashAmount: 430 });
  await seed("marimar-1", value, [payment("checkin-1", "checkin", 200, checkIn), payment("extend-1", "extend", 200, extendedAt), payment("order-1", "order", 30, extendedAt)]);
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "inventory/water"), { itemId: "water", quantity: 5 }));
  await correctHistoricalSale("VQSI-XKQM", extensionInput({ action: "duplicate", restoreStock: false }));
  assert.equal((await getDoc(doc(backend.db, "inventory/water"))).data().quantity, 5);
  assert.equal((await readBooking()).amountPaid, 0);
});

test("correct extension then remove the duplicate: no double reversal of the extension", async () => {
  await seed(); await correctHistoricalSale("VQSI-XKQM", extensionInput());
  const current = await readBooking();
  await correctHistoricalSale("VQSI-XKQM", extensionInput({ action: "duplicate", expectedUpdatedAt: current.updatedAt.toMillis(), expectedCorrectionCount: 1 }));
  assert.equal(computeShiftCollectedTotals(await readPayments(), []).totalCollected, 0);
  assert.equal((await getDocs(collection(backend.db, "saleCorrections"))).size, 2);
});

test("stale and concurrent correction submissions can only commit once", async () => {
  await seed();
  const results = await Promise.allSettled([correctHistoricalSale("VQSI-XKQM", extensionInput()), correctHistoricalSale("VQSI-XKQM", extensionInput())]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await getDocs(collection(backend.db, "saleCorrections"))).size, 1);
  assert.equal((await readBooking()).amountPaid, 200);
});

test("unreconciled history and invalid corrections fail without changing the sale", async () => {
  await seed("marimar-1", booking(), [payment("checkin-1", "checkin", 200, checkIn)]);
  await assert.rejects(correctHistoricalSale("VQSI-XKQM", extensionInput()), /payment history/i);
  assert.equal((await readBooking()).amountPaid, 400);
  assert.equal((await getDocs(collection(backend.db, "saleCorrections"))).size, 0);
  const payments = [payment("checkin-1", "checkin", 200, checkIn), payment("extend-1", "extend", 200, extendedAt)];
  assert.throws(() => planSaleCorrection(booking(), payments, extensionInput({ extensionAmount: 300 })), /valid corrected extension/);
  assert.throws(() => planSaleCorrection(booking(), payments, extensionInput({ removePayment: { cash: 201, gcash: 0, qrph: 0 } })), /cannot exceed/);
  assert.throws(() => planSaleCorrection(booking({ status: "active" }), payments, extensionInput()), /front-desk/);
  assert.throws(() => planSaleCorrection(booking(), payments, extensionInput({ reason: "" })), /reason/);
  assert.equal(effectivePaymentEvents(payments).length, 2);
});

test("cashiers/supervisors cannot correct finished sales or forge correction entries", async () => {
  await seed();
  for (const [uid, role] of [["cashier-1", "cashier"], ["supervisor-1", "supervisor"]]) {
    assert.equal(canCorrectSale(role), false);
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(updateDoc(doc(db, "bookings/VQSI-XKQM"), { hoursBooked: 3, totalRoomCharge: 200 }));
    await assertFails(setDoc(doc(db, "transactions/forged"), payment("forged", "sale_correction", -200, extendedAt, { cashierId: uid })));
    await assertFails(setDoc(doc(db, "transactions/forged-reversal"), payment("forged-reversal", "reversal", -200, extendedAt, { cashierId: uid })));
    await assertFails(setDoc(doc(db, "saleCorrections/forged"), { correctionId: "forged", correctedBy: uid }));
    backend.db = db; backend.auth.currentUser = { uid };
    await assert.rejects(correctHistoricalSale("VQSI-XKQM", extensionInput()), /Only Owner/);
  }
  assert.equal(canCorrectSale("owner"), true); assert.equal(canCorrectSale("admin"), true); assert.equal(canCorrectSale("superadmin"), true);
});

test("cashier payment-method changes still preserve paid totals; correction audit is immutable", async () => {
  await seed();
  const cashier = env.authenticatedContext("cashier-1").firestore();
  await assertSucceeds(updateDoc(doc(cashier, "bookings/VQSI-XKQM"), { paymentMethod: "gcash", splitCashAmount: 0, splitGcashAmount: 400 }));
  await assertFails(updateDoc(doc(cashier, "bookings/VQSI-XKQM"), { splitCashAmount: -1, splitGcashAmount: 401 }));
  await assertFails(updateDoc(doc(cashier, "bookings/VQSI-XKQM"), { amountPaid: 200 }));
  // Restore the test fixture before using the correction service.
  await seed(); await correctHistoricalSale("VQSI-XKQM", extensionInput());
  const history = (await getDocs(collection(backend.db, "saleCorrections"))).docs[0];
  await assertFails(updateDoc(history.ref, { reason: "erase the audit" }));
  await assertFails(deleteDoc(history.ref));
});
