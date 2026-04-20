#!/usr/bin/env bash
set -euo pipefail

# Self-hosted GitHub Actions runner bootstrap for macOS
# This script outlines steps to provision a macOS runner for MemPalace sync workflow.
# Expects the following environment variables to be provided by the operator:
#   GH_TOKEN          - GitHub token with repo scope
#   REPO_URL          - HTTPS URL of the repository (e.g. https://github.com/bdunk881/autoflow-brand)
#   RUNNER_NAME       - Desired runner name
#   RUNNER_LABELS     - Labels for the runner (default: self-hosted)
#   RUNNER_TARBALL_URL- Direct URL to the macOS runner tarball from GitHub
#
set +e
echo "== Self-hosted Runner Bootstrap (macOS) =="

REPO_URL_E=${REPO_URL:-"https://github.com/bdunk881/autoflow-brand"}
RUNNER_NAME=${RUNNER_NAME:-"mempalace-sync-macos"}
LABELS=${RUNNER_LABELS:-"self-hosted"}
WORKDIR=${WORKDIR:-"$HOME/actions-runner"}
GH_TOKEN=${GH_TOKEN:-}
RUNNER_TARBALL_URL=${RUNNER_TARBALL_URL:-}

function require_var() {
  local v="${!1}"
  if [[ -z "$v" ]]; then
    echo "ERROR: environment variable '$1' is not set." >&2
    exit 1
  fi
}

require_var GH_TOKEN
require_var REPO_URL_E
require_var RUNNER_TARBALL_URL

echo "Repository: ${REPO_URL_E}"
echo "Runner: ${RUNNER_NAME}"
echo "Labels: ${LABELS}"
echo "Working dir: ${WORKDIR}"

mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "Downloading runner package..."
curl -L -o actions-runner-osx.tar.gz "$RUNNER_TARBALL_URL"

echo "Extracting runner..."
tar xzf actions-runner-osx.tar.gz

echo "Configuring runner..."
./config.sh --url "$REPO_URL_E" --token "$GH_TOKEN" --labels "$LABELS" --name "$RUNNER_NAME"

echo "Installing runner as a macOS service..."
sudo ./svc.sh install
echo "Starting runner service..."
sudo ./svc.sh start

echo "Runner provisioning complete. Verify in GitHub: Settings → Actions → Runners."
echo "Remember to ensure MEMPALACE_PALACE path and mempalace-store CLI are accessible to the runner during jobs."
