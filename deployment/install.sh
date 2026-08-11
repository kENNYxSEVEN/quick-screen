#!/usr/bin/env bash

set -Eeuo pipefail

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

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
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

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: sudo ./install.sh [options]

Installs the ready-made screen-share deployment artifact from this directory.
No application build is performed on the server.

Options:
  --domain <domain>          Public domain, for example share.example.com
  --public-ip <IPv4>         Public IPv4 address of this server
  --ssl-cert <path>          Existing TLS certificate path
  --ssl-key <path>           Existing TLS private key path
  --api-port <port>          API TCP port (default: 3001)
  --media-port <port>        Media HTTP TCP port (default: 3002)
  --udp-port-min <port>      Pion UDP range start (default: 50000)
  --udp-port-max <port>      Pion UDP range end (default: 50100)
  --non-interactive          Fail instead of prompting for missing values
  -h, --help                 Show this help
EOF
}

on_error() {
  local exit_code=$?
  printf 'Installation stopped at line %s (exit code %s).\n' "$1" "${exit_code}" >&2
  exit "${exit_code}"
}

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
  [[ "$(uname -m)" == "x86_64" ]] || die "This artifact requires an x86_64 server."
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

require_artifacts() {
  [[ -f "${SCRIPT_DIRECTORY}/web/index.html" ]] || die "Missing artifact: web/index.html"
  [[ -f "${SCRIPT_DIRECTORY}/api/dist/server.js" ]] || die "Missing artifact: api/dist/server.js"
  [[ -f "${SCRIPT_DIRECTORY}/api/package.json" ]] || die "Missing artifact: api/package.json"
  [[ -f "${SCRIPT_DIRECTORY}/media/screen-share-media" ]] || die "Missing artifact: media/screen-share-media"
  [[ -d "${SCRIPT_DIRECTORY}/env" ]] || die "Missing artifact directory: env"
}

prompt_required() {
  local label=$1
  local current_value=$2
  local value="${current_value}"

  if [[ -z "${value}" && "${NON_INTERACTIVE}" == false && -t 0 ]]; then
    read -r -p "${label}: " value
  fi

  [[ -n "${value}" ]] || die "${label} is required."
  printf '%s' "${value}"
}

prompt_with_default() {
  local label=$1
  local current_value=$2
  local default_value=$3
  local value="${current_value}"
  local input=""

  if [[ "${NON_INTERACTIVE}" == false && -t 0 ]]; then
    read -r -p "${label} [${value:-${default_value}}]: " input
    value="${input:-${value:-${default_value}}}"
  fi

  printf '%s' "${value:-${default_value}}"
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
  replace_tree "${SCRIPT_DIRECTORY}/web" "${web_directory}"
  chown -R root:root "${web_directory}"
  find "${web_directory}" -type d -exec chmod 0755 {} +
  find "${web_directory}" -type f -exec chmod 0644 {} +

  install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${API_DIRECTORY}" "${MEDIA_DIRECTORY}" "${ENV_DIRECTORY}"
  replace_tree "${SCRIPT_DIRECTORY}/api" "${API_DIRECTORY}"
  replace_tree "${SCRIPT_DIRECTORY}/media" "${MEDIA_DIRECTORY}"
  replace_tree "${SCRIPT_DIRECTORY}/env" "${ENV_DIRECTORY}"

  chmod 0750 "${MEDIA_DIRECTORY}/screen-share-media"
  secure_service_tree "${API_DIRECTORY}"
  secure_service_tree "${MEDIA_DIRECTORY}"
  secure_service_tree "${ENV_DIRECTORY}"
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

write_environment_files() {
  umask 027
  cat > "${ENV_DIRECTORY}/api.env" <<EOF
NODE_ENV=production
PORT=${API_PORT}
WEB_ORIGIN=https://${DOMAIN}
MEDIA_ORIGIN=http://127.0.0.1:${MEDIA_PORT}
EOF

  cat > "${ENV_DIRECTORY}/media.env" <<EOF
MEDIA_PORT=${MEDIA_PORT}
MEDIA_STUN_URLS=
MEDIA_PUBLIC_IP=${PUBLIC_IPV4}
MEDIA_ICE_DIAGNOSTICS=false
MEDIA_UDP_PORT_MIN=${UDP_PORT_MIN}
MEDIA_UDP_PORT_MAX=${UDP_PORT_MAX}
EOF

  chown root:"${SERVICE_GROUP}" "${ENV_DIRECTORY}/api.env" "${ENV_DIRECTORY}/media.env"
  chmod 0640 "${ENV_DIRECTORY}/api.env" "${ENV_DIRECTORY}/media.env"
}

write_systemd_units() {
  cat > "/etc/systemd/system/${API_SERVICE}.service" <<EOF
[Unit]
Description=iNGAMERS Screen Share API
After=network.target

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
EOF

  cat > "/etc/systemd/system/${MEDIA_SERVICE}.service" <<EOF
[Unit]
Description=iNGAMERS Screen Share Media
After=network.target

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
EOF

  chmod 0644 "/etc/systemd/system/${API_SERVICE}.service" "/etc/systemd/system/${MEDIA_SERVICE}.service"
}

write_nginx_vhost() {
  local web_directory="/var/www/${DOMAIN}"
  local vhost_path="/etc/nginx/sites-available/${DOMAIN}"
  local enabled_path="/etc/nginx/sites-enabled/${DOMAIN}"

  [[ ! -e "${enabled_path}" || -L "${enabled_path}" ]] || die "Refusing to replace non-symlink nginx site: ${enabled_path}"

  cat > "${vhost_path}" <<EOF
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
EOF

  ln -sfn "../sites-available/${DOMAIN}" "${enabled_path}"
  nginx -t
  systemctl reload nginx
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

show_summary() {
  printf '\nInstallation complete.\n'
  printf 'URL: https://%s\n' "${DOMAIN}"
  printf 'API service: %s\n' "$(systemctl is-active "${API_SERVICE}" || true)"
  printf 'Media service: %s\n' "$(systemctl is-active "${MEDIA_SERVICE}" || true)"
  printf 'Pion UDP range: %s-%s\n' "${UDP_PORT_MIN}" "${UDP_PORT_MAX}"
  printf '\nLogs:\n'
  printf '  journalctl -u %s -f\n' "${API_SERVICE}"
  printf '  journalctl -u %s -f\n' "${MEDIA_SERVICE}"
  printf '\nAllow UDP %s-%s in your VPS provider network rules and firewall. This installer does not modify firewall rules.\n' \
    "${UDP_PORT_MIN}" "${UDP_PORT_MAX}"
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
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
  require_command nginx
  require_command systemctl
  require_command curl
  require_command getent
  require_node
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
