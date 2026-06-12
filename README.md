# YesWeigh Service

Operations portal for [service.yesweigh.in](https://service.yesweigh.in) — part of the **YesWeigh** group.

Built with the same stack as YES LAB (yesgatcin): **React 19 + Vite + TypeScript + Firebase** (Auth, Firestore, Hosting), glassmorphism UI, role-based routing.

## Role hierarchy

| Level | Role | Access |
|-------|------|--------|
| 1 | **Super Admin** | Full control — CRUD staff, dealers, dealer staff |
| 2 | **Staff** | Company staff — CRUD dealers & dealer staff (same ops as super admin for onboarding) |
| 3 | **Dealer** | Service operations sidebar + manage own dealer staff |
| 4 | **Dealer Staff** | Dealer menu (field operations, no team management) |

Legacy `admin`, `director`, and `director_staff` values in Firestore are mapped automatically.

## Dealer sidebar

- Dashboard
- Products
- Verification & Stamping
- Training
- Quality Management
- Notifications
- Dealer Staff (team)
- My Profile

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Seed users

Bootstrap super admin:

```bash
npm run seed:admin -- admin@yesweigh.in YourPassword "YesWeigh Admin"
```

All role samples (one per role):

```bash
npm run seed:sample-users
```

Migrate existing Firestore docs after rename:

```bash
npm run migrate:dealer-rename
```

| Role | Email | Password (default) |
|------|-------|-------------------|
| Super Admin | `admin@yesweigh.in` | `YesWeigh@2026` |
| Super Admin (sample) | `superadmin@yesweigh.in` | `YesWeigh@2026` |
| Staff | `staff@yesweigh.in` | `YesWeigh@2026` |
| Dealer | `dealer@yesweigh.in` | `YesWeigh@2026` |
| Dealer Staff | `dealerstaff@yesweigh.in` | `YesWeigh@2026` |

Dealer Staff is linked to **Sample Dealer** (`dealer@yesweigh.in`).

## Build & deploy

```bash
npm run build
firebase deploy --only hosting,firestore,storage,functions
```

### GitHub Actions (CI)

Pushes to `main` run `.github/workflows/deploy.yml`: build, deploy **hosting + Firestore (rules/indexes) + Storage rules + Cloud Functions**, then sync the product catalog from Zoho into Firestore.

If the **functions** step fails with `Permissions denied enabling …`, a **Google Cloud project owner** must enable these APIs once in [APIs & Services](https://console.cloud.google.com/apis/library?project=yesweigh-service) (the CI service account cannot turn them on):

- [Artifact Registry API](https://console.cloud.google.com/apis/library/artifactregistry.googleapis.com?project=yesweigh-service)
- [Cloud Build API](https://console.cloud.google.com/apis/library/cloudbuild.googleapis.com?project=yesweigh-service)
- [Cloud Functions API](https://console.cloud.google.com/apis/library/cloudfunctions.googleapis.com?project=yesweigh-service)
- [Cloud Run Admin API](https://console.cloud.google.com/apis/library/run.googleapis.com?project=yesweigh-service) (`run.googleapis.com`)
- [Eventarc API](https://console.cloud.google.com/apis/library/eventarc.googleapis.com?project=yesweigh-service)
- [Secret Manager API](https://console.cloud.google.com/apis/library/secretmanager.googleapis.com?project=yesweigh-service)

The `FIREBASE_SERVICE_ACCOUNT` secret should use a service account with at least:

- Firebase Admin (or Firebase Hosting Admin + Cloud Functions Admin)
- Service Account User (on the default App Engine / compute service account)
- Cloud Build Editor (for 2nd gen functions)
- **Secret Manager Admin** (functions + CI post-deploy catalog sync read Zoho credentials)

CI passes `--force` on function deploys so Firebase can set the Artifact Registry cleanup policy non-interactively.

Then create the function secrets once (from a machine with Firebase CLI logged in):

```bash
firebase functions:secrets:set ZOHO_CLIENT_ID --project yesweigh-service
firebase functions:secrets:set ZOHO_CLIENT_SECRET --project yesweigh-service
firebase functions:secrets:set ZOHO_REFRESH_TOKEN --project yesweigh-service
```

Add a GitHub Actions secret **`ZOHO_ORGANIZATION_ID`** (Zoho Inventory → Settings → Organization Profile → Organization ID). CI writes this into `functions/.env.yesweigh-service` before deploying functions.

Cloud Functions (2nd gen) also require the Firebase project on the **Blaze (pay as you go)** plan with a billing account linked. If deploy fails with `cloudbilling.googleapis.com`, enable [Cloud Billing API](https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com?project=yesweigh-service) and upgrade at [Firebase Usage and billing](https://console.firebase.google.com/project/yesweigh-service/usage/details).

Hosting and Firestore rules still deploy even if functions fail, because CI runs those steps first.

## Firebase project

- Project: `yesweigh-service`
- Console: https://console.firebase.google.com/project/yesweigh-service/overview
- GitHub: https://github.com/yes-weigh/yesweighservice

## Business flow

1. **Super Admin** onboards staff, dealers, and dealer staff.
2. **Staff** can credential dealers and dealer staff in the field.
3. **Dealers** run day-to-day service ops and add **dealer staff** under their unit.
