#!/usr/bin/env bash
# Retry firebase deploy for transient Google API errors (e.g. firebaserules 503).
set -u

TARGETS="${1:?Usage: ci-firebase-deploy.sh <targets> [project]}"
PROJECT="${2:-yesweigh-service}"
MAX_ATTEMPTS="${FIREBASE_DEPLOY_RETRIES:-5}"
DELAY="${FIREBASE_DEPLOY_RETRY_DELAY_SEC:-20}"

run_deploy() {
  if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
    npx firebase-tools@15.22.1 deploy \
      --only "$TARGETS" \
      --project "$PROJECT" \
      --non-interactive
  else
    if [ -z "${FIREBASE_TOKEN:-}" ]; then
      echo "::error::FIREBASE_TOKEN or GOOGLE_APPLICATION_CREDENTIALS is required."
      return 1
    fi
    npx firebase-tools@15.22.1 deploy \
      --only "$TARGETS" \
      --project "$PROJECT" \
      --non-interactive \
      --token "$FIREBASE_TOKEN"
  fi
}

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "Firebase deploy attempt ${attempt}/${MAX_ATTEMPTS} (--only ${TARGETS})"
  if run_deploy; then
    echo "Deploy succeeded on attempt ${attempt}."
    exit 0
  fi

  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "::error::Firebase deploy failed after ${MAX_ATTEMPTS} attempts (--only ${TARGETS})."
    echo "::error::If the log shows HTTP 503 from firebaserules.googleapis.com, this is usually a transient Google outage — re-run the workflow."
    exit 1
  fi

  echo "Deploy failed; retrying in ${DELAY}s..."
  sleep "$DELAY"
  DELAY=$((DELAY * 2))
  attempt=$((attempt + 1))
done
