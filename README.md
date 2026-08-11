<div align="center">

<img src="./apps/web/public/logo-vervital.svg" alt="QUICK SCREEN" width="320">

<br><br>

**A fast, minimal, self-hosted screen sharing tool built on WebRTC and Pion SFU.**

Create a room, share a screen, send the link. No accounts and no client application required.

[Live demo](https://share.ingamers.pro) · [Installation](#installation) · [Updating](#updating) · [Development](#development)

[![Latest release](https://img.shields.io/github/v/release/kENNYxSEVEN/quick-screen?display_name=tag&sort=semver)](https://github.com/kENNYxSEVEN/quick-screen/releases/latest)
[![Release build](https://github.com/kENNYxSEVEN/quick-screen/actions/workflows/release.yml/badge.svg)](https://github.com/kENNYxSEVEN/quick-screen/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Self-hosted](https://img.shields.io/badge/self--hosted-yes-2ea44f)
![WebRTC](https://img.shields.io/badge/media-WebRTC-333333)
![Pion](https://img.shields.io/badge/SFU-Pion-00ADD8)

</div>

## Screenshots

### Home page
![QUICK SCREEN home](https://i.ibb.co/CsV4bPnV/home.png)

### Viewer live room
![QUICK SCREEN viewer live room](https://i.ibb.co/PvXdM6kC/live-room.png)

### Host room with stream settings
![QUICK SCREEN host room](https://i.ibb.co/DxKyyJj/host-room.png)


## Features

- **Room-based sharing** — create a room and share it with a simple link
- **Low-latency WebRTC** — powered by a lightweight Go/Pion SFU
- **Multiple viewers** — stream one screen to multiple viewers
- **Screen audio** — share supported system or tab audio
- **Pause, resume & change source** — control the stream without recreating the room
- **Stream settings** — configurable quality, FPS and bitrate
- **Desktop & mobile** — no client application required
- **No accounts** — simple room ownership with secure HttpOnly cookies
- **Self-hosted** — automated installation and updates on Ubuntu/Debian

## Tech stack

| Part | Technology |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind CSS, React Router |
| UI | shadcn-style components, Base UI, Lucide |
| API | Node.js, Express, WebSocket (`ws`) |
| Media | Go, Pion WebRTC |
| Workspace | pnpm, Turborepo |
| Production | Nginx, systemd |
| Releases | GitHub Actions, versioned Linux archives, SHA-256 checksums |

## Installation

Production releases support **x86_64 Ubuntu and Debian**.

### Requirements

**Server**

- Ubuntu or Debian on `x86_64`
- root or sudo access
- public IPv4 address
- domain or subdomain pointed to the server
- Node.js **22+** with npm
- Nginx
- `curl`, `tar`, `sha256sum`
- TCP `80` and `443` reachable publicly
- UDP `50000-50100` reachable publicly by default

Ports `3001` and `3002` are internal service ports and do **not** need to be exposed publicly.

### 1. Prepare the server

Install the basic packages:

```bash
sudo apt update
sudo apt install -y nginx curl ca-certificates
```

Verify Node.js and npm:

```bash
node --version
npm --version
```

Node.js 22 or newer is required.

Before installation:

- DNS must resolve the selected domain to the server
- TCP `80` and `443` must be reachable
- UDP `50000-50100` must be allowed in both the operating-system firewall and provider/network firewall when applicable

### 2. Download the installer

```bash
mkdir -p ~/quick-screen-install
cd ~/quick-screen-install

curl -fL \
  https://raw.githubusercontent.com/kENNYxSEVEN/quick-screen/main/deployment/install.sh \
  -o install.sh

chmod +x install.sh
```

### 3. Run it

```bash
sudo ./install.sh
```

Interactive installation asks for:

```text
Domain
Public IPv4
TLS certificate path [leave blank for automatic Let's Encrypt]
Let's Encrypt email
API port [3001]
Media port [3002]
Pion UDP port minimum [50000]
Pion UDP port maximum [50100]
```

For the standard setup, leave the TLS certificate path empty. The installer will obtain a Let's Encrypt certificate and configure automatic renewal.

The default API, media and UDP ports can normally be accepted by pressing Enter.

### Existing TLS certificate

An existing certificate can be used instead of Let's Encrypt:

```bash
sudo ./install.sh \
  --domain example.com \
  --public-ip <YOUR_IP> \
  --ssl-cert /path/to/fullchain.pem \
  --ssl-key /path/to/private.key
```

Optional port overrides are available through:

```text
--api-port
--media-port
--udp-port-min
--udp-port-max
```

A specific release can be installed with:

```bash
sudo ./install.sh --version v0.1.2
```

## Installed layout

```text
/opt/screen-share/
├── api/
├── media/
├── env/
│   ├── api.env
│   └── media.env
├── install.sh
├── update.sh
├── LICENSE
└── VERSION

/var/www/<domain>/                  # built React application

/etc/systemd/system/
├── screen-share-api.service
└── screen-share-media.service

/etc/nginx/sites-available/<domain>
/etc/nginx/sites-enabled/<domain>
```

When Let's Encrypt is selected, Certbot stores its certificate material under `/etc/letsencrypt/`.

## Updating

The updater installed by QUICK SCREEN is the normal update path:

```bash
sudo /opt/screen-share/update.sh
```

### Install a specific release

```bash
sudo /opt/screen-share/update.sh --version v0.1.2
```

### Reinstall the current release

```bash
sudo /opt/screen-share/update.sh --force
```

When the installed version already matches the target version, no application files are changed and the services are not restarted.

## Service management

Check service status:

```bash
systemctl status screen-share-api
systemctl status screen-share-media
```

Follow logs:

```bash
journalctl -u screen-share-api -f
journalctl -u screen-share-media -f
```

Restart services manually:

```bash
sudo systemctl restart screen-share-media
sudo systemctl restart screen-share-api
```

## Configuration

For standard installations, manual production `.env` editing is not required. The installer generates production configuration from the installation parameters.

The repository `.env.example` files remain useful for development, diagnostics and custom deployments.

### Web

| Variable | Default | Description |
|---|---:|---|
| `VITE_API_ORIGIN` | empty | API origin. Empty uses the same public origin as the web application. |
| `VITE_STUN_URLS` | empty | Optional comma-separated STUN servers used by browser PeerConnections. |
| `VITE_WEBRTC_DIAGNOSTICS` | `false` | Enables additional browser-side WebRTC signaling/ICE diagnostics. |

### API

| Variable | Default | Description |
|---|---:|---|
| `NODE_ENV` | `production` | Runs the API in production mode. |
| `PORT` | `3001` | Internal API HTTP/WebSocket port. |
| `WEB_ORIGIN` | — | Public QUICK SCREEN origin, for example `https://share.example.com`. |
| `MEDIA_ORIGIN` | `http://127.0.0.1:3002` | Internal media-service origin used by the API. |

### Media

| Variable | Default | Description |
|---|---:|---|
| `MEDIA_PORT` | `3002` | Internal HTTP signaling/health port of the media service. |
| `MEDIA_STUN_URLS` | empty | Optional STUN servers used by the Pion PeerConnection. |
| `MEDIA_PUBLIC_IP` | — | Public IPv4 address advertised to browser WebRTC clients. |
| `MEDIA_UDP_PORT_MIN` | `50000` | First UDP media port. |
| `MEDIA_UDP_PORT_MAX` | `50100` | Last UDP media port. |
| `MEDIA_ICE_DIAGNOSTICS` | `false` | Enables additional media-side ICE diagnostics. |


## Development

### Requirements

- Node.js
- pnpm
- Go

Clone the repository:

```bash
git clone https://github.com/kENNYxSEVEN/quick-screen.git
cd quick-screen
```

Install dependencies:

```bash
pnpm install
```

Create local environment files from the included examples:

```text
apps/web/.env.example   → apps/web/.env
apps/api/.env.example   → apps/api/.env
apps/media/.env.example → apps/media/.env
```

Start the React application and API:

```bash
pnpm dev
```

Start the Go/Pion media service in another terminal:

```bash
pnpm dev:media
```

The web development server is normally available through the Vite development port configured by the project.

Build a production deployment bundle:

```bash
pnpm build:deploy
```

The generated directory has the same basic structure used by GitHub Releases:

```text
deploy/
├── install.sh
├── update.sh
├── web/
├── api/
├── media/
└── env/
```

## License

QUICK SCREEN is released under the [MIT License](LICENSE).
