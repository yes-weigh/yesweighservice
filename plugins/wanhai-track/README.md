# Wan Hai Live Track (phone / Android)

Chrome extensions do **not** work on phones. On the **YesOne Android app**, Live track opens Wan Hai in an in-app WebView:

1. Pass the CAPTCHA  
2. Tap **Track now**  
3. App pastes the container, runs Query, reads status, saves to Firestore  

## Ship in the APK

```bash
npm run build:wanhai-track
npm install
npx cap sync android
# then build/release the Android app as usual
```

Until a new APK with this plugin is installed, phone browser / old APK only opens Wan Hai and copies the container for manual paste.
