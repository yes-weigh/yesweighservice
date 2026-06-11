# YesWeigh Service

Coming soon landing page for [service.yesweigh.in](https://service.yesweigh.in), hosted on Firebase.

## Stack

- Firebase Hosting (static site)
- Firestore (provisioned, not used yet)
- Firebase Auth — Email/Password (enabled, not used yet)

## Project

- Firebase project: `yesweigh-service`
- Console: https://console.firebase.google.com/project/yesweigh-service/overview
- Live preview: https://yesweigh-service.web.app
- GitHub: https://github.com/yes-weigh/yesweighservice

## Custom domain (service.yesweigh.in)

Add the custom domain in Firebase Hosting (one-time setup):

1. Open [Hosting → Domains](https://console.firebase.google.com/project/yesweigh-service/hosting/sites/yesweigh-service/domains)
2. Click **Add custom domain**
3. Enter `service.yesweigh.in`
4. Add the DNS records Firebase shows at your domain registrar (for `yesweigh.in`)

Firebase will provide A records and/or a TXT verification record for the `service` subdomain. SSL is provisioned automatically after DNS propagates.

`service.yesweigh.in` is already added to Firebase Auth authorized domains for future sign-in flows.

## Firestore & Auth

- **Firestore**: `(default)` database in `asia-south1`, deny-all rules until the app is built
- **Auth**: Email/Password sign-in enabled (verified during setup)
- Billing is linked to the same account as `yesweighmomentumhub` (required to initialize Auth via API; Firebase free tier still applies for typical usage)

## Local development

Serve the static files with any local server, for example:

```bash
npx serve public
```

## Deploy

```bash
firebase deploy
```

Deploy hosting only:

```bash
firebase deploy --only hosting
```
