# Marimar Inn

Real-time property management system for Marimar Inn — hourly-rate room booking, front-desk check-in/checkout, food & beverage ordering, and reporting.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js (App Router), React, Tailwind CSS, shadcn/ui |
| Backend | Firebase (Firestore + Firebase Auth) — no separate API server |
| Deployment | Vercel |

This is an independent project from the Davao Stainless POS — separate repo, separate Firebase project, no shared infrastructure.

## Roles

- **Owner** — full access: room catalog (add/edit/delete rooms, rates), staff accounts, inventory catalog/prices/restocking, removing an item from an active order, everything Cashier can do
- **Cashier** — front-desk operations: check-in/checkout, room status (available/cleaning/maintenance), placing F&B orders (deducts stock). Can't touch room rates, inventory prices/restocking, staff accounts, or remove an item once ordered — restocking and un-ordering both count as *increasing* stock, which Firestore rules reserve for Owner/Admin/manager

Roles are stored per-user in Firestore (`users/{uid}.role`) and enforced both in the UI (`ProtectedRoute`, nav links hidden per role) and in Firestore security rules (`firestore.rules`) — the rules are the real boundary, UI hiding is just convenience.

## Local setup

### Prerequisites

- Node.js 20+
- A Firebase project (see below)

### 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com), create a new project named e.g. "Marimar Inn".
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Firestore Database** → create a database (production mode is fine — `firestore.rules` in this repo defines access).
4. Deploy `firestore.rules` from this repo to your project (via the Firebase console's Rules editor, or the Firebase CLI: `firebase deploy --only firestore:rules`). When pasting into the console, select-all and replace the whole editor content, then confirm the last few lines match before publishing — partial pastes fail silently into a stale ruleset otherwise.
5. **Project settings** → General → "Your apps" → add a **Web app** → copy the config values.

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Paste the values from step 1.5 into `.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

### 3. Create the first Owner account

The app has no public sign-up — accounts are provisioned manually so only staff you create can sign in:

1. Firebase console → **Authentication** → Users → **Add user** → enter an email and password.
2. Copy the generated **User UID**.
3. Firebase console → **Firestore Database** → start a collection named `users` → document ID = the UID you copied → add fields:
   - `role` (string) = `owner`
   - `displayName` (string) = e.g. `Owner`
   - `email` (string) = the same email used in step 1

This first Owner is the only account that needs manual console setup — once signed in, use **Manage Staff** in the app to create every other account (Owner or Cashier), no console required.

### 4. Install and run

```bash
npm install
npm run dev
```

App: http://localhost:3000 — redirects to `/login` when signed out, `/dashboard` once signed in.

## Project structure

```
src/
├── app/
│   ├── login/                   # Public login page
│   ├── (app)/                    # Authenticated shell — layout wraps children in ProtectedRoute
│   │   ├── layout.tsx            # Header nav, role badge, sign-out — Owner-only links conditionally rendered
│   │   ├── dashboard/             # Room grid — the daily-ops home screen for both roles
│   │   ├── rooms/manage/          # Owner-only: room catalog CRUD + seed 17 rooms
│   │   ├── inventory/             # Owner-only: F&B catalog, prices, restock
│   │   └── users/                 # Owner-only: create/list staff accounts
│   └── page.tsx                  # Redirects to /login or /dashboard based on auth state
├── context/
│   └── auth-context.tsx          # AuthProvider / useAuth() — Firebase Auth + Firestore role lookup
├── components/
│   ├── auth/protected-route.tsx  # Redirect guard, optional allowedRoles
│   ├── rooms/                    # Room grid/card, check-in/checkout/status dialogs
│   ├── inventory/                # Order picker (cart), Owner-only item form
│   ├── users/                    # Staff account creation dialog
│   └── ui/                       # shadcn/ui components
├── hooks/
│   └── use-now-tick.ts           # Interval-based clock for live countdowns
└── lib/
    ├── firebase.ts               # Firebase client SDK init + secondary app for staff creation
    ├── rooms.ts                  # Room CRUD, status updates, seeding
    ├── bookings.ts                # Check-in/checkout/void/extendStay (check-in runs as one
    │                               Firestore transaction so room + optional F&B items + stock
    │                               all commit together)
    ├── inventory.ts               # Item CRUD, restock (Owner-only)
    ├── orders.ts                  # Add/remove an order line — transactional stock ↔ bill sync
    ├── notifications.ts           # Checkout-reminder / low-stock alerts — idempotent
    │                               create/resolve keyed by deterministic doc IDs so concurrent
    │                               staff sessions never produce duplicates
    ├── users.ts                   # Staff account creation (Owner-only)
    ├── time.ts                    # hoursElapsed() — shared by bookings.ts and notifications.ts
    └── types.ts
firestore.rules                   # Firestore security rules
```

## Roadmap

| Phase | Scope | Status |
|-------|--------|--------|
| **1** | Auth, Owner/Cashier roles | **Done** |
| **2** | Room dashboard, check-in/checkout core, Owner-only room & staff management | **Done** |
| **3** | Food & beverage ordering, inventory | **Done** |
| **4** | Extend-stay, real-time notifications (checkout reminders, low stock) | **Done** |
| **5** | Reports & analytics (daily/monthly/inventory, exports) | **Done** |
| **6** | UI polish — dark mode, brand styling, keyboard shortcuts | Next |

## Deploy on Vercel

Import the repo in [Vercel](https://vercel.com/new), add the same `NEXT_PUBLIC_FIREBASE_*` environment variables in the project settings, and deploy.
