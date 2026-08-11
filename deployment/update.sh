#!/usr/bin/env bash

set -Eeuo pipefail

readonly SERVICE_USER="screen-share"
readonly SERVICE_GROUP="screen-share"
readonly API_DIRECTORY="/opt/screen-share/api"
readonly MEDIA_DIRECTORY="/opt/screen-share/media"
readonly API_ENV="/opt/screen-share/env/api.env"
readonly MEDIA_ENV="/opt/screen-share/env/media.env"
readonly API_SERVICE="screen-share-api"
readonly MEDIA_SERVICE="screen-share-media"

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: sudo ./update.sh

Updates screen-share from the ready-made deployment artifact in this directory.
It replaces web, API and media files only. Existing environment files and nginx
configuration are intentionally left untouched.
EOF
}

on_error() {
  local exit_code=$?
  printf 'Update stopped at line %s (exit code %s).\n' "$1" "${exit_code}" >&2
  exit "${exit_code}"
}

trap 'on_error $LINENO' ERR

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run this updater as root (for example: sudo ./update.sh)."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

require_node() {
  require_command node
  require_command npm

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "${node_major}" =~ ^[0-9]+$ ]] || die "Unable to determine the installed Node.js version."
  (( node_major >= 22 )) || die "Node.js 22 or newer is required (found $(node --version))."
}

validate_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] || \
    die "Domain must be a valid fully qualified domain name."
}

require_artifacts() {
  [[ -f "${SCRIPT_DIRECTORY}/web/index.html" ]] || die "Missing artifact: web/index.html"
  [[ -f "${SCRIPT_DIRECTORY}/api/dist/server.js" ]] || die "Missing artifact: api/dist/server.js"
  [[ -f "${SCRIPT_DIRECTORY}/api/package.json" ]] || die "Missing artifact: api/package.json"
  [[ -f "${SCRIPT_DIRECTORY}/media/screen-share-media" ]] || die "Missing artifact: media/screen-share-media"
}

require_existing_installation() {
  id -u "${SERVICE_USER}" >/dev/null 2>&1 || die "screen-share is not installed; run install.sh first."
  [[ -f "${API_ENV}" && -f "${MEDIA_ENV}" ]] || die "Environment files are missing; run install.sh first."
  [[ -f "/etc/systemd/system/${API_SERVICE}.service" ]] || die "API service is missing; run install.sh first."
  [[ -f "/etc/systemd/system/${MEDIA_SERVICE}.service" ]] || die "Media service is missing; run install.sh first."
}

replace_tree() {
  local source_directory=$1
  local destination_directory=$2

  [[ -d "${source_directory}" ]] || die "Artifact directory is missing: ${source_directory}"
  install -d "${destination_directory}"
  find "${destination_directory}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  cp -a "${source_directory}/." "${destination_directory}/"
}

secure_service_tree() {
  local directory=$1

  chown -R root:"${SERVICE_GROUP}" "${directory}"
  chmod -R g+rX,o-rwx "${directory}"
}

install_api_dependencies() {
  npm \
    --prefix "${API_DIRECTORY}" \
    install \
    --omit=dev \
    --ignore-scripts \
    --no-audit \
    --no-fund \
    --package-lock=false
  secure_service_tree "${API_DIRECTORY}"
}

read_env_value() {
  local file=$1
  local key=$2
  local value

  value="$(sed -n "s/^${key}=//p" "${file}" | tail -n 1)"
  [[ -n "${value}" ]] || die "Missing ${key} in ${file}."
  printf '%s' "${value}"
}

wait_for_health() {
  local name=$1
  local url=$2
  local attempt

  for attempt in $(seq 1 15); do
    if curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null; then
      printf '%s health check passed.\n' "${name}"
      return
    fi
    sleep 1
  done

  die "${name} health check failed: ${url}"
}

main() {
  if (($# > 0)); then
    case "$1" in
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  fi

  require_root
  require_command systemctl
  require_command curl
  require_node
  require_artifacts
  require_existing_installation

  local domain web_origin api_port media_port
  web_origin="$(read_env_value "${API_ENV}" "WEB_ORIGIN")"
  [[ "${web_origin}" == https://* ]] || die "WEB_ORIGIN must use https in ${API_ENV}."
  domain="${web_origin#https://}"
  validate_domain "${domain}"
  [[ -d "/var/www/${domain}" ]] || die "Existing web directory is missing: /var/www/${domain}"
  api_port="$(read_env_value "${API_ENV}" "PORT")"
  media_port="$(read_env_value "${MEDIA_ENV}" "MEDIA_PORT")"

  systemctl stop "${API_SERVICE}" "${MEDIA_SERVICE}"

  replace_tree "${SCRIPT_DIRECTORY}/web" "/var/www/${domain}"
  chown -R root:root "/var/www/${domain}"
  find "/var/www/${domain}" -type d -exec chmod 0755 {} +
  find "/var/www/${domain}" -type f -exec chmod 0644 {} +

  replace_tree "${SCRIPT_DIRECTORY}/api" "${API_DIRECTORY}"
  replace_tree "${SCRIPT_DIRECTORY}/media" "${MEDIA_DIRECTORY}"
  chmod 0750 "${MEDIA_DIRECTORY}/screen-share-media"
  secure_service_tree "${API_DIRECTORY}"
  secure_service_tree "${MEDIA_DIRECTORY}"
  install_api_dependencies

  systemctl daemon-reload
  systemctl restart "${MEDIA_SERVICE}"
  systemctl restart "${API_SERVICE}"
  wait_for_health "Media" "http://127.0.0.1:${media_port}/health"
  wait_for_health "API" "http://127.0.0.1:${api_port}/health"

  printf 'Update complete. Existing environment files and nginx configuration were not changed.\n'
  printf 'API service: %s\n' "$(systemctl is-active "${API_SERVICE}" || true)"
  printf 'Media service: %s\n' "$(systemctl is-active "${MEDIA_SERVICE}" || true)"
}

main "$@"
