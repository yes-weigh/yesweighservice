#!/usr/bin/env bash
# Retry firebase deploy for transient Google API errors (e.g. firebaserules 503).
set -u

TARGETS="${1:?Usage: ci-firebase-deploy.sh <targets> [project]}"
PROJECT="${2:-yesweigh-service}"
MAX_ATTEMPTS="${FIREBASE_DEPLOY_RETRIES:-5}"
DELAY="${FIREBASE_DEPLOY_RETRY_DELAY_SEC:-20}"
FIREBASE_CLI="${FIREBASE_CLI:-npx --yes firebase-tools@15.22.1}"

run_deploy() {
  local debug_flag=()
  if [ "${CI_FIREBASE_DEBUG:-}" = "1" ]; then
    debug_flag=(--debug)
  fi

  if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
    if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
      echo "::error::GOOGLE_APPLICATION_CREDENTIALS file not found: $GOOGLE_APPLICATION_CREDENTIALS"
      return 1
    fi

    # google-github-actions/auth sets these; they can interfere with firebase-tools ADC.
    env -u FIREBASE_TOKEN \
      -u CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE \
      -u GOOGLE_GHA_CREDS_PATH \
      GOOGLE_APPLICATION_CREDENTIALS="$GOOGLE_APPLICATION_CREDENTIALS" \
      $FIREBASE_CLI deploy \
      --only "$TARGETS" \
      --project "$PROJECT" \
      --non-interactive \
      "${debug_flag[@]}"
  else
    if [ -z "${FIREBASE_TOKEN:-}" ]; then
      echo "::error::FIREBASE_TOKEN or GOOGLE_APPLICATION_CREDENTIALS is required."
      return 1
    fi
    $FIREBASE_CLI deploy \
      --only "$TARGETS" \
      --project "$PROJECT" \
      --non-interactive \
      --token "$FIREBASE_TOKEN" \
      "${debug_flag[@]}"
  fi
}

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "Firebase deploy attempt ${attempt}/${MAX_ATTEMPTS} (--only ${TARGETS})"
  if run_deploy; then
    echo "Deploy succeeded on attempt ${attempt}."
    exit 0
  fi

  if [ "$attempt" -eq 1 ]; then
    echo "Retrying with firebase --debug enabled."
    CI_FIREBASE_DEBUG=1
  fi

  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "::error::Firebase deploy failed after ${MAX_ATTEMPTS} attempts (--only ${TARGETS})."
    echo "::error::If token exchange passed but deploy still fails, check IAM roles for the service account (Firebase Admin, Service Account User)."
    echo "::error::If the log shows HTTP 503 from firebaserules.googleapis.com, this is usually a transient Google outage — re-run the workflow."
    exit 1
  fi

  echo "Deploy failed; retrying in ${DELAY}s..."
  sleep "$DELAY"
  DELAY=$((DELAY * 2))
  attempt=$((attempt + 1))
done
