# Marimar Inn tablet app

This Android wrapper opens the live Marimar Inn site and prints receipts over **Bluetooth Classic (SPP)** — the same method the other inn APK uses. Chrome cannot do that, which is why “connected” in the browser still prints nothing.

## Setup

1. Pair the thermal printer in **Android Settings → Bluetooth** (not inside Chrome).
2. Open this `android-app` folder in Android Studio.
3. Set the live site URL in `app/src/main/res/values/strings.xml` (`app_url`) if it is not already correct.
4. Build → Generate Signed Bundle / APK, or Run on the tablet.
5. On the tablet, open **Marimar Inn**, tap the printer icon, then tap the paired printer. Use **Print test**.

No RawBT install is needed.

## APK versions

Each printer-app update is a **new file**, never overwrite:

- `D:\Downloads\MarimarInn-tablet-v1.apk` — first tablet app
- `D:\Downloads\MarimarInn-tablet-v2.apk` — Bluetooth scan permission (Nearby devices)
- `D:\Downloads\MarimarInn-tablet-v3.apk` — reconnects on every print so reprint works
- Next change will be `v4`, and so on

Install the **highest** version number. Allow Nearby devices when Android asks.

