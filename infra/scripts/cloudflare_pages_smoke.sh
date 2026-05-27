#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <dashboard|docs|landing> <base-url>" >&2
  exit 1
fi

project="$1"
base_url="${2%/}"

case "$project" in
  dashboard)
    paths=(
      "/"
      "/login"
      "/pricing"
    )
    ;;
  docs)
    paths=(
      "/"
      "/getting-started"
      "/api-reference"
      "/integrations-sdk-v1"
    )
    ;;
  landing)
    paths=(
      "/"
      "/blog"
      "/demo"
      "/signup"
      "/privacy"
      "/terms"
      "/robots.txt"
      "/sitemap.xml"
    )
    ;;
  *)
    echo "Unknown project: $project" >&2
    exit 1
    ;;
esac

for path in "${paths[@]}"; do
  url="${base_url}${path}"
  code=$(/usr/bin/curl -L -sS -o /dev/null -w "%{http_code}" "$url")
  if [[ "$code" != "200" ]]; then
    echo "::error::${project} smoke failed for ${url} with HTTP ${code}" >&2
    exit 1
  fi

  echo "OK ${project} ${path} -> ${code}"
done

if [[ "$project" == "dashboard" ]]; then
  csp="$(
    /usr/bin/curl -sSI "${base_url}/" | tr -d '\r' | awk '
      tolower($1) == "content-security-policy:" {
        sub(/^[^:]*:[[:space:]]*/, "");
        print;
        exit;
      }
    '
  )"
  if [[ -z "$csp" ]]; then
    echo "::warning::dashboard CSP header missing at ${base_url}/"
  elif [[ "$csp" != *"img.logo.dev"* ]]; then
    echo "::error::dashboard CSP must allow img.logo.dev (logo.dev integration logos). Got: ${csp}" >&2
    exit 1
  fi
  echo "OK ${project} CSP allows img.logo.dev"
fi
