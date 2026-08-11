#!/usr/bin/env bash

set -Eeuo pipefail

readonly GITHUB_REPOSITORY="kENNYxSEVEN/quick-screen"
readonly GITHUB_URL="https://github.com/${GITHUB_REPOSITORY}"
readonly SERVICE_USER="screen-share"
readonly SERVICE_GROUP="screen-share"
readonly INSTALL_ROOT="/opt/screen-share"
readonly API_DIRECTORY="${INSTALL_ROOT}/api"
readonly MEDIA_DIRECTORY="${INSTALL_ROOT}/media"
readonly ENV_DIRECTORY="${INSTALL_ROOT}/env"
readonly API_ENV="${ENV_DIRECTORY}/api.env"
readonly MEDIA_ENV="${ENV_DIRECTORY}/media.env"
readonly VERSION_FILE="${INSTALL_ROOT}/VERSION"
readonly API_SERVICE="screen-share-api"
readonly MEDIA_SERVICE="screen-share-media"

TARGET_VERSION=""
FORCE=false
WORK_DIRECTORY=""
BUNDLE_DIRECTORY=""
BACKUP_DIRECTORY=""
WEB_DIRECTORY=""
API_PORT=""
MEDIA_PORT=""
UPDATE_IN_PROGRESS=false
UPDATE_SUCCEEDED=false
PREVIOUS_VERSION=""

info() {
  printf '[INFO] %s\n' "$*"
}

ok() {
  printf '[ OK ] %s\n' "$*"
}

die() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF_USAGE'
Usage: sudo /opt/screen-share/update.sh [options]

Downloads a QUICK SCREEN release from GitHub, verifies its SHA-256 checksum,
and updates the installed web, API and media files. Existing environment files,
TLS files and Nginx configuration are left untouched.

Options:
  --version <tag>   Install a specific release, for example v0.1.2 (default: latest)
  --force           Reinstall even when the requested version is already installed
  -h, --help        Show this help
EOF_USAGE
}

restore_tree() {
  local backup_directory=$1
  local destination_directory=$2

  [[ -d "${backup_directory}" ]] || return 0
  rm -rf -- "${destination_directory}"
  cp -a "${backup_directory}" "${destination_directory}"
}

rollback_update() {
  set +e
  printf '\n[WARN] Update failed. Restoring the previous installation...\n' >&2

  restore_tree "${BACKUP_DIRECTORY}/web" "${WEB_DIRECTORY}"
  restore_tree "${BACKUP_DIRECTORY}/api" "${API_DIRECTORY}"
  restore_tree "${BACKUP_DIRECTORY}/media" "${MEDIA_DIRECTORY}"

  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl restart "${MEDIA_SERVICE}" >/dev/null 2>&1 || true
  systemctl restart "${API_SERVICE}" >/dev/null 2>&1 || true

  printf '[WARN] Previous application files restored. Environment and Nginx configuration were never modified.\n' >&2
}

on_exit() {
  local exit_code=$?
  trap - EXIT

  if [[ "${UPDATE_IN_PROGRESS}" == true && "${UPDATE_SUCCEEDED}" != true ]]; then
    rollback_update
  fi

  if [[ -n "${WORK_DIRECTORY}" && -d "${WORK_DIRECTORY}" ]]; then
    rm -rf -- "${WORK_DIRECTORY}"
  fi

  exit "${exit_code}"
}

on_error() {
  local exit_code=$?
  printf 'Update stopped at line %s (exit code %s).\n' "$1" "${exit_code}" >&2
  return "${exit_code}"
}

trap on_exit EXIT
trap 'on_error $LINENO' ERR

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run this updater as root (for example: sudo ${INSTALL_ROOT}/update.sh)."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

require_supported_platform() {
  [[ -r /etc/os-release ]] || die "Unable to identify this Linux distribution."
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == "debian" || "${ID:-}" == "ubuntu" ]] || die "Only Debian and Ubuntu are supported."
  [[ "$(uname -m)" == "x86_64" ]] || die "This release requires an x86_64 server."
}

require_node() {
  require_command node
  require_command npm

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "${node_major}" =~ ^[0-9]+$ ]] || die "Unable to determine the installed Node.js version."
  (( node_major >= 22 )) || die "Node.js 22 or newer is required (found $(node --version))."
}

validate_release_tag() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Release tag must use the vMAJOR.MINOR.PATCH format."
}

resolve_latest_release_tag() {
  local effective_url tag

  effective_url="$(
    curl \
      --fail \
      --location \
      --silent \
      --show-error \
      --retry 3 \
      --retry-delay 1 \
      --proto '=https' \
      --tlsv1.2 \
      --output /dev/null \
      --write-out '%{url_effective}' \
      "${GITHUB_URL}/releases/latest"
  )"

  effective_url="${effective_url%/}"
  tag="${effective_url##*/}"
  validate_release_tag "${tag}"
  printf '%s' "${tag}"
}

download_file() {
  local url=$1
  local destination=$2

  curl \
    --fail \
    --location \
    --silent \
    --show-error \
    --retry 3 \
    --retry-delay 1 \
    --proto '=https' \
    --tlsv1.2 \
    --output "${destination}" \
    "${url}"
}

current_version() {
  if [[ -f "${VERSION_FILE}" ]]; then
    tr -d '\r\n' < "${VERSION_FILE}"
  else
    printf 'unknown'
  fi
}

require_existing_installation() {
  id -u "${SERVICE_USER}" >/dev/null 2>&1 || die "QUICK SCREEN is not installed; run install.sh first."
  [[ -f "${API_ENV}" && -f "${MEDIA_ENV}" ]] || die "Environment files are missing; run install.sh first."
  [[ -f "/etc/systemd/system/${API_SERVICE}.service" ]] || die "API service is missing; run install.sh first."
  [[ -f "/etc/systemd/system/${MEDIA_SERVICE}.service" ]] || die "Media service is missing; run install.sh first."
  [[ -d "${API_DIRECTORY}" && -d "${MEDIA_DIRECTORY}" ]] || die "Installed application files are missing."
}

read_env_value() {
  local file=$1
  local key=$2
  local value

  value="$(sed -n "s/^${key}=//p" "${file}" | tail -n 1)"
  [[ -n "${value}" ]] || die "Missing ${key} in ${file}."
  printf '%s' "${value}"
}

validate_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] || \
    die "Domain must be a valid fully qualified domain name."
}

show_up_to_date() {
  local bold=""
  local green=""
  local cyan=""
  local reset=""

  if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    bold=$'\033[1m'
    green=$'\033[32m'
    cyan=$'\033[36m'
    reset=$'\033[0m'
  fi

  printf '\n'
  printf '%b============================================================%b\n' "${green}${bold}" "${reset}"
  printf '%b  ✓ QUICK SCREEN IS UP TO DATE%b\n' "${green}${bold}" "${reset}"
  printf '%b============================================================%b\n' "${green}${bold}" "${reset}"
  printf '\n'
  printf '  Version       %b%s%b\n' "${cyan}${bold}" "${TARGET_VERSION}" "${reset}"
  printf '  API           %b✓%b %s\n' "${green}" "${reset}" "$(systemctl is-active "${API_SERVICE}" || true)"
  printf '  Media         %b✓%b %s\n' "${green}" "${reset}" "$(systemctl is-active "${MEDIA_SERVICE}" || true)"
  printf '\n'
  printf '  No files were changed and no services were restarted.\n'
  printf '\n'
  printf '%b============================================================%b\n' "${green}${bold}" "${reset}"
  printf '\n'
}

prepare_release_bundle() {
  if [[ -z "${TARGET_VERSION}" ]]; then
    info "Checking the latest GitHub release..."
    TARGET_VERSION="$(resolve_latest_release_tag)"
  else
    validate_release_tag "${TARGET_VERSION}"
  fi

  PREVIOUS_VERSION="$(current_version)"

  printf 'Current version: %s\n' "${PREVIOUS_VERSION}"
  printf 'Target version:  %s\n' "${TARGET_VERSION}"

  if [[ "${PREVIOUS_VERSION}" == "${TARGET_VERSION}" && "${FORCE}" != true ]]; then
    show_up_to_date
    exit 0
  fi

  local archive_name checksum_name archive_url checksum_url
  archive_name="quick-screen-${TARGET_VERSION}-linux-amd64.tar.gz"
  checksum_name="${archive_name}.sha256"
  archive_url="${GITHUB_URL}/releases/download/${TARGET_VERSION}/${archive_name}"
  checksum_url="${GITHUB_URL}/releases/download/${TARGET_VERSION}/${checksum_name}"

  WORK_DIRECTORY="$(mktemp -d -t quick-screen-update.XXXXXXXX)"

  info "Downloading QUICK SCREEN ${TARGET_VERSION}..."
  download_file "${archive_url}" "${WORK_DIRECTORY}/${archive_name}"
  download_file "${checksum_url}" "${WORK_DIRECTORY}/${checksum_name}"

  info "Verifying release checksum..."
  (
    cd "${WORK_DIRECTORY}"
    sha256sum --check --strict "${checksum_name}"
  )

  tar -xzf "${WORK_DIRECTORY}/${archive_name}" -C "${WORK_DIRECTORY}"
  BUNDLE_DIRECTORY="${WORK_DIRECTORY}/quick-screen"

  require_bundle_artifacts

  local bundled_version
  bundled_version="$(tr -d '\r\n' < "${BUNDLE_DIRECTORY}/VERSION")"
  [[ "${bundled_version}" == "${TARGET_VERSION}" ]] || \
    die "Release bundle version mismatch: expected ${TARGET_VERSION}, found ${bundled_version}."

  ok "Release ${TARGET_VERSION} downloaded and verified."
}

require_bundle_artifacts() {
  [[ -f "${BUNDLE_DIRECTORY}/web/index.html" ]] || die "Missing artifact: web/index.html"
  [[ -f "${BUNDLE_DIRECTORY}/api/dist/server.js" ]] || die "Missing artifact: api/dist/server.js"
  [[ -f "${BUNDLE_DIRECTORY}/api/package.json" ]] || die "Missing artifact: api/package.json"
  [[ -f "${BUNDLE_DIRECTORY}/media/screen-share-media" ]] || die "Missing artifact: media/screen-share-media"
  [[ -f "${BUNDLE_DIRECTORY}/update.sh" ]] || die "Missing artifact: update.sh"
  [[ -f "${BUNDLE_DIRECTORY}/VERSION" ]] || die "Missing artifact: VERSION"
}

backup_current_installation() {
  BACKUP_DIRECTORY="${WORK_DIRECTORY}/backup"
  mkdir -p "${BACKUP_DIRECTORY}"

  info "Creating a temporary rollback copy..."
  cp -a "${WEB_DIRECTORY}" "${BACKUP_DIRECTORY}/web"
  cp -a "${API_DIRECTORY}" "${BACKUP_DIRECTORY}/api"
  cp -a "${MEDIA_DIRECTORY}" "${BACKUP_DIRECTORY}/media"
  ok "Rollback copy created."
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

wait_for_health() {
  local name=$1
  local url=$2
  local attempt

  for attempt in $(seq 1 15); do
    if curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null; then
      ok "${name} health check passed."
      return
    fi
    sleep 1
  done

  die "${name} health check failed: ${url}"
}

install_management_files() {
  install -o root -g root -m 0755 "${BUNDLE_DIRECTORY}/update.sh" "${INSTALL_ROOT}/update.sh"
  if [[ -f "${BUNDLE_DIRECTORY}/install.sh" ]]; then
    install -o root -g root -m 0755 "${BUNDLE_DIRECTORY}/install.sh" "${INSTALL_ROOT}/install.sh"
  fi
  if [[ -f "${BUNDLE_DIRECTORY}/LICENSE" ]]; then
    install -o root -g root -m 0644 "${BUNDLE_DIRECTORY}/LICENSE" "${INSTALL_ROOT}/LICENSE"
  fi
  install -o root -g root -m 0644 "${BUNDLE_DIRECTORY}/VERSION" "${VERSION_FILE}"
}

perform_update() {
  backup_current_installation
  UPDATE_IN_PROGRESS=true

  info "Stopping QUICK SCREEN services..."
  systemctl stop "${API_SERVICE}" "${MEDIA_SERVICE}"

  info "Updating web files..."
  replace_tree "${BUNDLE_DIRECTORY}/web" "${WEB_DIRECTORY}"
  chown -R root:root "${WEB_DIRECTORY}"
  find "${WEB_DIRECTORY}" -type d -exec chmod 0755 {} +
  find "${WEB_DIRECTORY}" -type f -exec chmod 0644 {} +

  info "Updating API files..."
  replace_tree "${BUNDLE_DIRECTORY}/api" "${API_DIRECTORY}"
  secure_service_tree "${API_DIRECTORY}"
  install_api_dependencies

  info "Updating media files..."
  replace_tree "${BUNDLE_DIRECTORY}/media" "${MEDIA_DIRECTORY}"
  chmod 0750 "${MEDIA_DIRECTORY}/screen-share-media"
  secure_service_tree "${MEDIA_DIRECTORY}"

  systemctl daemon-reload
  systemctl restart "${MEDIA_SERVICE}"
  systemctl restart "${API_SERVICE}"

  wait_for_health "Media" "http://127.0.0.1:${MEDIA_PORT}/health"
  wait_for_health "API" "http://127.0.0.1:${API_PORT}/health"

  install_management_files
  UPDATE_SUCCEEDED=true
}

show_summary() {
  local api_status
  local media_status
  local bold=""
  local green=""
  local cyan=""
  local reset=""

  api_status="$(systemctl is-active "${API_SERVICE}" || true)"
  media_status="$(systemctl is-active "${MEDIA_SERVICE}" || true)"

  if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    bold=$'\033[1m'
    green=$'\033[32m'
    cyan=$'\033[36m'
    reset=$'\033[0m'
  fi

  printf '\n'
  printf '%b============================================================%b\n' "${green}${bold}" "${reset}"
  printf '%b  ✓ QUICK SCREEN UPDATED SUCCESSFULLY%b\n' "${green}${bold}" "${reset}"
  printf '%b============================================================%b\n' "${green}${bold}" "${reset}"
  printf '\n'

  printf '%bUpdate%b\n' "${bold}" "${reset}"
  printf '  Version       %b%s%b  →  %b%s%b\n' \
    "${cyan}" "${PREVIOUS_VERSION}" "${reset}" \
    "${cyan}${bold}" "${TARGET_VERSION}" "${reset}"
  printf '  API           %b✓%b %s\n' "${green}" "${reset}" "${api_status}"
  printf '  Media         %b✓%b %s\n' "${green}" "${reset}" "${media_status}"
  printf '  Environment   %b✓%b preserved\n' "${green}" "${reset}"
  printf '  Nginx         %b✓%b preserved\n' "${green}" "${reset}"
  printf '\n'

  printf '%bNext update%b\n' "${bold}" "${reset}"
  printf '  sudo %s/update.sh\n' "${INSTALL_ROOT}"
  printf '\n'

  printf '%b============================================================%b\n' "${green}${bold}" "${reset}"
  printf '%b  Update finished. QUICK SCREEN is ready.%b\n' "${green}${bold}" "${reset}"
  printf '%b============================================================%b\n' "${green}${bold}" "${reset}"
  printf '\n'
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      --version) TARGET_VERSION=${2:-}; shift 2 ;;
      --force) FORCE=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  done
}

main() {
  parse_arguments "$@"
  require_root
  require_supported_platform
  require_command systemctl
  require_command curl
  require_command tar
  require_command sha256sum
  require_command mktemp
  require_command sed
  require_node
  require_existing_installation

  local domain web_origin
  web_origin="$(read_env_value "${API_ENV}" "WEB_ORIGIN")"
  [[ "${web_origin}" == https://* ]] || die "WEB_ORIGIN must use https in ${API_ENV}."
  domain="${web_origin#https://}"
  validate_domain "${domain}"
  WEB_DIRECTORY="/var/www/${domain}"
  [[ -d "${WEB_DIRECTORY}" ]] || die "Existing web directory is missing: ${WEB_DIRECTORY}"

  API_PORT="$(read_env_value "${API_ENV}" "PORT")"
  MEDIA_PORT="$(read_env_value "${MEDIA_ENV}" "MEDIA_PORT")"

  prepare_release_bundle
  perform_update
  show_summary
}

main "$@"
