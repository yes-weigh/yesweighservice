# Android APK (thin shell)

Warehouse / store-room / admin staff use this APK for LAN label printing.
Everyone else keeps using the PWA at https://service.yesweigh.in.

## How it works

- The APK is a Capacitor WebView pointed at the live site (`capacitor.config.ts` → `server.url`).
- Day-to-day UI and label layout changes ship via GitHub Actions → Firebase Hosting (no new APK).
- Rebuild the APK only when native print code or Android config changes.
- Printer IP/port live in Firestore (`appSettings/localPrinterSettings`) — change in **Settings → Local printers**.

## One-time setup (developer machine)

1. Install [Android Studio](https://developer.android.com/studio) (SDK + platform tools).
2. From repo root:

```bash
npm install
npm run build:tcp-print
npm run build
npx cap add android
npx cap sync android
npm run cap:open
```

3. In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. Distribute the debug/release APK to warehouse / store-room / admin phones (sideload is fine for internal use).

Later syncs (after native changes):

```bash
npm run cap:sync
```

## Staff usage

1. Phone on the **same Wi‑Fi** as the label printer.
2. Open the APK → sign in as admin/staff.
3. **Settings → Local printers** → confirm IP (default `192.168.1.39`) → **Save** → **Test print**.

## Notes

- Test print sends a small TSPL label over TCP port **9100**.
- If nothing prints, the printer may expect ZPL/EZPL instead of TSPL — we can switch the payload without a new APK once hosting is updated.
- Reserve the printer IP on the router (DHCP is currently on).
