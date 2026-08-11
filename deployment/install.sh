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
readonly API_SERVICE="screen-share-api"
readonly MEDIA_SERVICE="screen-share-media"
readonly DEFAULT_API_PORT="3001"
readonly DEFAULT_MEDIA_PORT="3002"
readonly DEFAULT_UDP_PORT_MIN="50000"
readonly DEFAULT_UDP_PORT_MAX="50100"

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"
BUNDLE_DIRECTORY="${SCRIPT_DIRECTORY}"
WORK_DIRECTORY=""
RELEASE_TAG=""
DOMAIN=""
PUBLIC_IPV4=""
SSL_CERT=""
SSL_KEY=""
API_PORT="${DEFAULT_API_PORT}"
MEDIA_PORT="${DEFAULT_MEDIA_PORT}"
UDP_PORT_MIN="${DEFAULT_UDP_PORT_MIN}"
UDP_PORT_MAX="${DEFAULT_UDP_PORT_MAX}"
NON_INTERACTIVE=false
NODE_BIN=""

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
Usage: sudo ./install.sh [options]

Installs QUICK SCREEN on an x86_64 Ubuntu/Debian server.

When the deployment artifacts are not present next to this script, the installer
retrieves the requested release from GitHub, verifies its SHA-256 checksum, and
installs the ready-made release bundle. No application build is performed on the
server.

Options:
  --version <tag>           Release to install, for example v0.1.1 (default: latest)
  --domain <domain>         Public domain, for example share.example.com
  --public-ip <IPv4>        Public IPv4 address of this server
  --ssl-cert <path>         Existing TLS certificate path
  --ssl-key <path>          Existing TLS private key path
  --api-port <port>         API TCP port (default: 3001)
  --media-port <port>       Media HTTP TCP port (default: 3002)
  --udp-port-min <port>     Pion UDP range start (default: 50000)
  --udp-port-max <port>     Pion UDP range end (default: 50100)
  --non-interactive         Fail instead of prompting for missing values
  -h, --help                Show this help
EOF_USAGE
}

cleanup() {
  if [[ -n "${WORK_DIRECTORY}" && -d "${WORK_DIRECTORY}" ]]; then
    rm -rf -- "${WORK_DIRECTORY}"
  fi
}

on_error() {
  local exit_code=$?
  printf 'Installation stopped at line %s (exit code %s).\n' "$1" "${exit_code}" >&2
  exit "${exit_code}"
}

trap cleanup EXIT
trap 'on_error $LINENO' ERR

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run this installer as root (for example: sudo ./install.sh)."
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

  NODE_BIN="$(command -v node)"
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

  info "Resolving the latest GitHub release..." >&2
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

has_local_artifacts() {
  [[ -f "${SCRIPT_DIRECTORY}/web/index.html" ]] && \
    [[ -f "${SCRIPT_DIRECTORY}/api/dist/server.js" ]] && \
    [[ -f "${SCRIPT_DIRECTORY}/api/package.json" ]] && \
    [[ -f "${SCRIPT_DIRECTORY}/media/screen-share-media" ]] && \
    [[ -d "${SCRIPT_DIRECTORY}/env" ]] && \
    [[ -f "${SCRIPT_DIRECTORY}/update.sh" ]]
}

prepare_release_bundle() {
  if [[ -z "${RELEASE_TAG}" ]] && has_local_artifacts; then
    BUNDLE_DIRECTORY="${SCRIPT_DIRECTORY}"
    if [[ -f "${BUNDLE_DIRECTORY}/VERSION" ]]; then
      RELEASE_TAG="$(tr -d '\r\n' < "${BUNDLE_DIRECTORY}/VERSION")"
    else
      RELEASE_TAG="development"
    fi
    info "Using deployment artifacts from ${BUNDLE_DIRECTORY}."
    return
  fi

  require_command tar
  require_command sha256sum

  if [[ -z "${RELEASE_TAG}" ]]; then
    RELEASE_TAG="$(resolve_latest_release_tag)"
  else
    validate_release_tag "${RELEASE_TAG}"
  fi

  local archive_name checksum_name archive_url checksum_url
  archive_name="quick-screen-${RELEASE_TAG}-linux-amd64.tar.gz"
  checksum_name="${archive_name}.sha256"
  archive_url="${GITHUB_URL}/releases/download/${RELEASE_TAG}/${archive_name}"
  checksum_url="${GITHUB_URL}/releases/download/${RELEASE_TAG}/${checksum_name}"

  WORK_DIRECTORY="$(mktemp -d -t quick-screen-install.XXXXXXXX)"

  info "Downloading QUICK SCREEN ${RELEASE_TAG}..."
  download_file "${archive_url}" "${WORK_DIRECTORY}/${archive_name}"
  download_file "${checksum_url}" "${WORK_DIRECTORY}/${checksum_name}"

  info "Verifying release checksum..."
  (
    cd "${WORK_DIRECTORY}"
    sha256sum --check --strict "${checksum_name}"
  )

  tar -xzf "${WORK_DIRECTORY}/${archive_name}" -C "${WORK_DIRECTORY}"
  BUNDLE_DIRECTORY="${WORK_DIRECTORY}/quick-screen"

  [[ -f "${BUNDLE_DIRECTORY}/VERSION" ]] || die "Release bundle does not contain VERSION."
  local bundled_version
  bundled_version="$(tr -d '\r\n' < "${BUNDLE_DIRECTORY}/VERSION")"
  [[ "${bundled_version}" == "${RELEASE_TAG}" ]] || \
    die "Release bundle version mismatch: expected ${RELEASE_TAG}, found ${bundled_version}."

  ok "Release ${RELEASE_TAG} downloaded and verified."
}

require_artifacts() {
  [[ -f "${BUNDLE_DIRECTORY}/web/index.html" ]] || die "Missing artifact: web/index.html"
  [[ -f "${BUNDLE_DIRECTORY}/api/dist/server.js" ]] || die "Missing artifact: api/dist/server.js"
  [[ -f "${BUNDLE_DIRECTORY}/api/package.json" ]] || die "Missing artifact: api/package.json"
  [[ -f "${BUNDLE_DIRECTORY}/media/screen-share-media" ]] || die "Missing artifact: media/screen-share-media"
  [[ -d "${BUNDLE_DIRECTORY}/env" ]] || die "Missing artifact directory: env"
  [[ -f "${BUNDLE_DIRECTORY}/update.sh" ]] || die "Missing artifact: update.sh"
}

trim_whitespace() {
  local value=$1
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

can_prompt() {
  [[ "${NON_INTERACTIVE}" == false && -r /dev/tty && -w /dev/tty ]]
}

prompt_required() {
  local label=$1
  local current_value=$2
  local value="${current_value}"

  if [[ -z "${value}" ]] && can_prompt; then
    read -r -p "${label}: " value </dev/tty
  fi

  value="$(trim_whitespace "${value}")"
  [[ -n "${value}" ]] || die "${label} is required."
  printf '%s' "${value}"
}

prompt_with_default() {
  local label=$1
  local current_value=$2
  local default_value=$3
  local value="${current_value}"
  local input=""

  if can_prompt; then
    read -r -p "${label} [${value:-${default_value}}]: " input </dev/tty
    input="$(trim_whitespace "${input}")"
    value="${input:-${value:-${default_value}}}"
  fi

  value="$(trim_whitespace "${value:-${default_value}}")"
  printf '%s' "${value}"
}

is_valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 ))
}

validate_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] || \
    die "Domain must be a valid fully qualified domain name."
}

validate_public_ipv4() {
  local ip=$1
  local first second third fourth
  IFS='.' read -r first second third fourth <<< "${ip}"

  [[ -n "${first:-}" && -n "${second:-}" && -n "${third:-}" && -n "${fourth:-}" ]] || \
    die "Public IPv4 address is invalid."
  for octet in "${first}" "${second}" "${third}" "${fourth}"; do
    [[ "${octet}" =~ ^[0-9]+$ ]] && (( 10#${octet} <= 255 )) || die "Public IPv4 address is invalid."
  done

  (( 10#${first} >= 1 && 10#${first} <= 223 )) || die "Public IPv4 address is invalid."
  if (( 10#${first} == 10 || 10#${first} == 127 || 10#${first} == 0 )); then
    die "Public IPv4 address must not be private or loopback."
  fi
  if (( 10#${first} == 169 && 10#${second} == 254 )); then
    die "Public IPv4 address must not be link-local."
  fi
  if (( 10#${first} == 172 && 10#${second} >= 16 && 10#${second} <= 31 )); then
    die "Public IPv4 address must not be private."
  fi
  if (( 10#${first} == 192 && 10#${second} == 168 )); then
    die "Public IPv4 address must not be private."
  fi
}

validate_configuration() {
  validate_domain "${DOMAIN}"
  validate_public_ipv4 "${PUBLIC_IPV4}"
  is_valid_port "${API_PORT}" || die "API port must be an integer between 1 and 65535."
  is_valid_port "${MEDIA_PORT}" || die "Media port must be an integer between 1 and 65535."
  is_valid_port "${UDP_PORT_MIN}" || die "UDP port minimum must be an integer between 1 and 65535."
  is_valid_port "${UDP_PORT_MAX}" || die "UDP port maximum must be an integer between 1 and 65535."
  (( 10#${API_PORT} != 10#${MEDIA_PORT} )) || die "API and media ports must be different."
  (( 10#${UDP_PORT_MIN} <= 10#${UDP_PORT_MAX} )) || die "UDP port minimum must not exceed UDP port maximum."
  [[ -f "${SSL_CERT}" && -r "${SSL_CERT}" ]] || die "TLS certificate is not readable: ${SSL_CERT}"
  [[ -f "${SSL_KEY}" && -r "${SSL_KEY}" ]] || die "TLS private key is not readable: ${SSL_KEY}"
}

require_fresh_installation() {
  if [[ -f "${API_DIRECTORY}/dist/server.js" || -f "${API_ENV:-${ENV_DIRECTORY}/api.env}" || \
        -f "/etc/systemd/system/${API_SERVICE}.service" ]]; then
    die "An existing QUICK SCREEN installation was detected. Use ${INSTALL_ROOT}/update.sh to update it."
  fi
}

ensure_service_account() {
  if ! getent group "${SERVICE_GROUP}" >/dev/null; then
    groupadd --system "${SERVICE_GROUP}"
  fi
  if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd \
      --system \
      --gid "${SERVICE_GROUP}" \
      --home-dir /nonexistent \
      --shell /usr/sbin/nologin \
      "${SERVICE_USER}"
  fi
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

install_artifacts() {
  local web_directory="/var/www/${DOMAIN}"

  install -d -o root -g root -m 0755 "${web_directory}"
  replace_tree "${BUNDLE_DIRECTORY}/web" "${web_directory}"
  chown -R root:root "${web_directory}"
  find "${web_directory}" -type d -exec chmod 0755 {} +
  find "${web_directory}" -type f -exec chmod 0644 {} +

  install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${API_DIRECTORY}" "${MEDIA_DIRECTORY}" "${ENV_DIRECTORY}"
  replace_tree "${BUNDLE_DIRECTORY}/api" "${API_DIRECTORY}"
  replace_tree "${BUNDLE_DIRECTORY}/media" "${MEDIA_DIRECTORY}"
  replace_tree "${BUNDLE_DIRECTORY}/env" "${ENV_DIRECTORY}"

  chmod 0750 "${MEDIA_DIRECTORY}/screen-share-media"
  secure_service_tree "${API_DIRECTORY}"
  secure_service_tree "${MEDIA_DIRECTORY}"
  secure_service_tree "${ENV_DIRECTORY}"

  install -o root -g root -m 0755 "${BUNDLE_DIRECTORY}/update.sh" "${INSTALL_ROOT}/update.sh"
  if [[ -f "${BUNDLE_DIRECTORY}/install.sh" ]]; then
    install -o root -g root -m 0755 "${BUNDLE_DIRECTORY}/install.sh" "${INSTALL_ROOT}/install.sh"
  fi
  if [[ -f "${BUNDLE_DIRECTORY}/LICENSE" ]]; then
    install -o root -g root -m 0644 "${BUNDLE_DIRECTORY}/LICENSE" "${INSTALL_ROOT}/LICENSE"
  fi

  if [[ -f "${BUNDLE_DIRECTORY}/VERSION" ]]; then
    install -o root -g root -m 0644 "${BUNDLE_DIRECTORY}/VERSION" "${INSTALL_ROOT}/VERSION"
  else
    printf '%s\n' "${RELEASE_TAG:-development}" > "${INSTALL_ROOT}/VERSION"
    chmod 0644 "${INSTALL_ROOT}/VERSION"
  fi

  ok "Deployment artifacts installed."
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
  ok "API runtime dependencies installed."
}

write_environment_files() {
  umask 027
  cat > "${ENV_DIRECTORY}/api.env" <<EOF_API
NODE_ENV=production
PORT=${API_PORT}
WEB_ORIGIN=https://${DOMAIN}
MEDIA_ORIGIN=http://127.0.0.1:${MEDIA_PORT}
EOF_API

  cat > "${ENV_DIRECTORY}/media.env" <<EOF_MEDIA
MEDIA_PORT=${MEDIA_PORT}
MEDIA_STUN_URLS=
MEDIA_PUBLIC_IP=${PUBLIC_IPV4}
MEDIA_ICE_DIAGNOSTICS=false
MEDIA_UDP_PORT_MIN=${UDP_PORT_MIN}
MEDIA_UDP_PORT_MAX=${UDP_PORT_MAX}
EOF_MEDIA

  chown root:"${SERVICE_GROUP}" "${ENV_DIRECTORY}/api.env" "${ENV_DIRECTORY}/media.env"
  chmod 0640 "${ENV_DIRECTORY}/api.env" "${ENV_DIRECTORY}/media.env"
  ok "Production environment files written."
}

write_systemd_units() {
  cat > "/etc/systemd/system/${API_SERVICE}.service" <<EOF_API_SERVICE
[Unit]
Description=QUICK SCREEN API
After=network-online.target ${MEDIA_SERVICE}.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${API_DIRECTORY}
EnvironmentFile=${ENV_DIRECTORY}/api.env
ExecStart=${NODE_BIN} ${API_DIRECTORY}/dist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF_API_SERVICE

  cat > "/etc/systemd/system/${MEDIA_SERVICE}.service" <<EOF_MEDIA_SERVICE
[Unit]
Description=QUICK SCREEN Media
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${MEDIA_DIRECTORY}
EnvironmentFile=${ENV_DIRECTORY}/media.env
ExecStart=${MEDIA_DIRECTORY}/screen-share-media
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF_MEDIA_SERVICE

  chmod 0644 "/etc/systemd/system/${API_SERVICE}.service" "/etc/systemd/system/${MEDIA_SERVICE}.service"
  ok "systemd services written."
}

write_nginx_vhost() {
  local web_directory="/var/www/${DOMAIN}"
  local vhost_path="/etc/nginx/sites-available/${DOMAIN}"
  local enabled_path="/etc/nginx/sites-enabled/${DOMAIN}"

  [[ ! -e "${enabled_path}" || -L "${enabled_path}" ]] || die "Refusing to replace non-symlink nginx site: ${enabled_path}"

  cat > "${vhost_path}" <<EOF_NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};

    root ${web_directory};
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /ws {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF_NGINX

  ln -sfn "../sites-available/${DOMAIN}" "${enabled_path}"
  nginx -t
  systemctl reload nginx
  ok "Nginx virtual host enabled."
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

show_summary() {
  local installed_version="unknown"
  [[ -f "${INSTALL_ROOT}/VERSION" ]] && installed_version="$(tr -d '\r\n' < "${INSTALL_ROOT}/VERSION")"

  printf '\nQUICK SCREEN installation complete.\n'
  printf 'Version: %s\n' "${installed_version}"
  printf 'URL: https://%s\n' "${DOMAIN}"
  printf 'API service: %s\n' "$(systemctl is-active "${API_SERVICE}" || true)"
  printf 'Media service: %s\n' "$(systemctl is-active "${MEDIA_SERVICE}" || true)"
  printf 'Pion UDP range: %s-%s\n' "${UDP_PORT_MIN}" "${UDP_PORT_MAX}"
  printf 'Updater: %s/update.sh\n' "${INSTALL_ROOT}"
  printf '\nLogs:\n'
  printf '  journalctl -u %s -f\n' "${API_SERVICE}"
  printf '  journalctl -u %s -f\n' "${MEDIA_SERVICE}"
  printf '\nUDP %s-%s must be allowed in the VPS/provider firewall. The installer does not modify firewall rules.\n' \
    "${UDP_PORT_MIN}" "${UDP_PORT_MAX}"
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      --version) RELEASE_TAG=${2:-}; shift 2 ;;
      --domain) DOMAIN=${2:-}; shift 2 ;;
      --public-ip) PUBLIC_IPV4=${2:-}; shift 2 ;;
      --ssl-cert) SSL_CERT=${2:-}; shift 2 ;;
      --ssl-key) SSL_KEY=${2:-}; shift 2 ;;
      --api-port) API_PORT=${2:-}; shift 2 ;;
      --media-port) MEDIA_PORT=${2:-}; shift 2 ;;
      --udp-port-min) UDP_PORT_MIN=${2:-}; shift 2 ;;
      --udp-port-max) UDP_PORT_MAX=${2:-}; shift 2 ;;
      --non-interactive) NON_INTERACTIVE=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  done
}

main() {
  parse_arguments "$@"
  require_root
  require_supported_platform
  require_command curl
  require_command nginx
  require_command systemctl
  require_command getent
  require_command mktemp
  require_node
  require_fresh_installation
  prepare_release_bundle
  require_artifacts

  DOMAIN="$(prompt_required "Domain" "${DOMAIN}")"
  PUBLIC_IPV4="$(prompt_required "Public IPv4" "${PUBLIC_IPV4}")"
  SSL_CERT="$(prompt_required "TLS certificate path" "${SSL_CERT}")"
  SSL_KEY="$(prompt_required "TLS private key path" "${SSL_KEY}")"
  API_PORT="$(prompt_with_default "API port" "${API_PORT}" "${DEFAULT_API_PORT}")"
  MEDIA_PORT="$(prompt_with_default "Media port" "${MEDIA_PORT}" "${DEFAULT_MEDIA_PORT}")"
  UDP_PORT_MIN="$(prompt_with_default "Pion UDP port minimum" "${UDP_PORT_MIN}" "${DEFAULT_UDP_PORT_MIN}")"
  UDP_PORT_MAX="$(prompt_with_default "Pion UDP port maximum" "${UDP_PORT_MAX}" "${DEFAULT_UDP_PORT_MAX}")"
  validate_configuration

  ensure_service_account
  install_artifacts
  install_api_dependencies
  write_environment_files
  write_systemd_units
  systemctl daemon-reload
  systemctl enable "${MEDIA_SERVICE}" "${API_SERVICE}"
  systemctl restart "${MEDIA_SERVICE}"
  systemctl restart "${API_SERVICE}"
  wait_for_health "Media" "http://127.0.0.1:${MEDIA_PORT}/health"
  wait_for_health "API" "http://127.0.0.1:${API_PORT}/health"
  write_nginx_vhost
  show_summary
}

main "$@"