#!/bin/bash
set -eo pipefail

usage() {
    echo "Usage: $0 <user@host> <authtoken> <domain>"
    echo "       $0 <user@host> stop|start|status"
    echo ""
    echo "Manages ngrok as a systemd service on a remote machine via SSH,"
    echo "proxying https://<domain> to localhost:3000."
    echo ""
    echo "Commands:"
    echo "  <authtoken> <domain>  Install/configure and start ngrok"
    echo "  start                 Start the existing ngrok service"
    echo "  stop                  Stop and remove the ngrok service"
    echo "  status                Show the ngrok service status"
    echo ""
    echo "Examples:"
    echo "  $0 arunoda@brain 2abc123token brain.ngrok-free.app"
    echo "  $0 arunoda@brain start"
    echo "  $0 arunoda@brain stop"
    echo "  $0 arunoda@brain status"
    exit 1
}

# First arg must be an SSH target
SSH_TARGET="${1:-}"
if [[ ! "$SSH_TARGET" == *@* ]]; then
    usage
fi
shift

# Pipe this script's remote portion over SSH
REMOTE_SCRIPT='
set -eo pipefail

SERVICE_NAME="ngrok-brain"

if [ "$1" = "stop" ]; then
    echo "Stopping $SERVICE_NAME..."
    sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    sudo systemctl daemon-reload
    echo "ngrok stopped and service removed."
    exit 0
fi

if [ "$1" = "status" ]; then
    sudo systemctl status "$SERVICE_NAME" --no-pager
    exit 0
fi

if [ "$1" = "start" ]; then
    sudo systemctl start "$SERVICE_NAME"
    echo "ngrok started."
    sudo systemctl status "$SERVICE_NAME" --no-pager
    exit 0
fi

AUTHTOKEN="$1"
DOMAIN="$2"

if [ -z "$AUTHTOKEN" ] || [ -z "$DOMAIN" ]; then
    echo "Error: authtoken and domain are required."
    exit 1
fi

# Install ngrok if missing
if ! command -v ngrok &>/dev/null; then
    echo "ngrok not found. Installing..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  NGROK_ARCH="amd64" ;;
        aarch64) NGROK_ARCH="arm64" ;;
        armv7l)  NGROK_ARCH="arm" ;;
        *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    curl -sSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${NGROK_ARCH}.tgz" | sudo tar xz -C /usr/local/bin
fi

# Configure authtoken
ngrok config add-authtoken "$AUTHTOKEN"

# Create systemd service
echo "Creating systemd service..."
NGROK_BIN=$(which ngrok)
NGROK_CONFIG="$HOME/.config/ngrok/ngrok.yml"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<EOF
[Unit]
Description=ngrok tunnel for brain
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
ExecStart=${NGROK_BIN} http 3000 --domain=${DOMAIN} --config=${NGROK_CONFIG}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "ngrok running as systemd service: $SERVICE_NAME"
echo "  URL: https://$DOMAIN"
echo "  Status: sudo systemctl status $SERVICE_NAME"
echo "  Logs:   sudo journalctl -u $SERVICE_NAME -f"
'

echo "Running on remote: $SSH_TARGET"
ssh "$SSH_TARGET" "bash -s -- $*" <<< "$REMOTE_SCRIPT"
