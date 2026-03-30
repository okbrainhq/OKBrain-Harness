#!/bin/bash

# setup.sh
# Purpose: Installs dependencies and prepares the environment for the brain app on Debian.
# Usage:
#   Production: ./setup.sh <HOSTNAME> <REPO_URL>
#   Dev:        ./setup.sh --dev

set -eo pipefail

# Parse flags
DEV_MODE=false
INSTALL_OLLAMA=false
for arg in "$@"; do
    case "$arg" in
        --dev) DEV_MODE=true ;;
        --setup-ollama) INSTALL_OLLAMA=true ;;
    esac
done

APP_DIR="/var/www/brain"

if [ "$DEV_MODE" = false ]; then
    # Collect positional args (skip flags)
    POSITIONAL=()
    for arg in "$@"; do
        case "$arg" in
            --*) ;; # skip flags
            *) POSITIONAL+=("$arg") ;;
        esac
    done
    if [ ${#POSITIONAL[@]} -lt 2 ]; then
        echo "Error: Hostname and repository URL are required."
        echo "Usage:"
        echo "  Production: ./setup.sh <HOSTNAME> <REPO_URL> [--setup-ollama]"
        echo "  Dev:        ./setup.sh --dev [--setup-ollama]"
        exit 1
    fi
    HOSTNAME="${POSITIONAL[0]}"
    REPO_URL="${POSITIONAL[1]}"
    echo "Starting setup for Brain App (production)..."
    echo "Target Directory: $APP_DIR"
    echo "Repository: $REPO_URL"
    echo "Hostname: $HOSTNAME"
else
    echo "Starting setup for Brain App (dev mode)..."
fi

# Detect real user if running with sudo
REAL_USER=${SUDO_USER:-$USER}
echo "Configuring for user: $REAL_USER"

echo "Checking sudo access..."
if ! sudo -n true 2>/dev/null; then
    echo "ERROR: This setup requires sudo access without interactive password prompts."
    echo "Ensure this user has sudo privileges, then re-run setup."
    exit 1
fi

# ============================================================
# Shared steps (both dev and production)
# ============================================================

# 1. Update APT
echo "Updating apt..."
sudo apt update

# 2. Install basic tools
echo "Installing basic tools (curl, git, unzip, sqlite3)..."
sudo apt install -y curl git unzip sqlite3 rsync

# 3. Install Node.js (v20)
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Installing Node.js v20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js is already installed: $(node -v)"
fi

# 4. Install Ollama (opt-in with --ollama flag)
if [ "$INSTALL_OLLAMA" = true ]; then
    if ! command -v ollama &> /dev/null; then
        echo "Installing Ollama..."
        curl -fsSL https://ollama.com/install.sh | sh
    else
        echo "Ollama already installed: $(ollama --version)"
    fi

    # Pull embedding model
    echo "Pulling nomic-embed-text:v1.5 model..."
    ollama pull nomic-embed-text:v1.5
else
    echo "Skipping Ollama installation (--setup-ollama flag not set)."
    echo "To enable Ollama later, run: ./setup.sh --setup-ollama"
fi

# 5. Create Upload Data Directory
DATA_DIR="/var/www/brain-data"
echo "Creating upload data directory at $DATA_DIR..."
sudo mkdir -p "$DATA_DIR/uploads"
sudo chown -R "$REAL_USER":"$REAL_USER" "$DATA_DIR"

# 6. Install sandbox tools (available to all users including brain-sandbox)
echo "Installing sandbox tools (ffmpeg, python3, jq, imagemagick)..."
sudo apt install -y ffmpeg python3 python3-pip python3-venv jq imagemagick

# 7. Install Python packages
echo "Installing Python packages (scikit-learn, numpy, pandas, yfinance)..."
sudo pip3 install --break-system-packages scikit-learn numpy pandas matplotlib pillow pypdf pdfplumber yfinance

# 8. Setup shell-command sandbox runtime
SANDBOX_USER="brain-sandbox"
echo "Configuring shell sandbox user ($SANDBOX_USER)..."
if ! id "$SANDBOX_USER" &>/dev/null; then
    sudo useradd --system --shell /usr/sbin/nologin --create-home --home-dir "/home/$SANDBOX_USER" "$SANDBOX_USER"
fi

# Allow app process to traverse sandbox home (without listing) for shared upload reads
sudo chmod 751 "/home/$SANDBOX_USER"

# Shared directories for shell tooling
sudo mkdir -p "/home/$SANDBOX_USER/upload_images" "/home/$SANDBOX_USER/skills" "/home/$SANDBOX_USER/.local/bin"
sudo chown -R "$SANDBOX_USER":"$SANDBOX_USER" "/home/$SANDBOX_USER/upload_images" "/home/$SANDBOX_USER/skills" "/home/$SANDBOX_USER/.local"
sudo chmod 755 "/home/$SANDBOX_USER/upload_images" "/home/$SANDBOX_USER/skills" "/home/$SANDBOX_USER/.local" "/home/$SANDBOX_USER/.local/bin"

# Ensure sandbox login shell PATH includes local agent tools
echo "Configuring PATH for $SANDBOX_USER..."
SANDBOX_HOME="/home/$SANDBOX_USER"
SANDBOX_PROFILE="$SANDBOX_HOME/.profile"
sudo touch "$SANDBOX_PROFILE"
if ! sudo grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$SANDBOX_PROFILE"; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' | sudo tee -a "$SANDBOX_PROFILE" > /dev/null
fi
sudo chown "$SANDBOX_USER":"$SANDBOX_USER" "$SANDBOX_PROFILE"

# 9. Configure sudoers for shell sandbox commands
echo "Configuring sudoers for shell sandbox commands..."
SUDOERS_FILE="/etc/sudoers.d/brain-shell-sandbox"
sudo tee "$SUDOERS_FILE" > /dev/null <<EOF
# Allow app user to execute systemd-run only as brain-sandbox (pinned uid/gid)
$REAL_USER ALL=(root) NOPASSWD: /usr/bin/systemd-run --wait --pipe --quiet --uid=brain-sandbox --gid=brain-sandbox *
EOF
sudo chmod 440 "$SUDOERS_FILE"
sudo visudo -cf "$SUDOERS_FILE"

echo "Validating sandbox run capability as $REAL_USER..."
if ! sudo -u "$REAL_USER" sudo -n systemd-run --wait --pipe --quiet --uid=brain-sandbox --gid=brain-sandbox -- true 2>/dev/null; then
    echo "ERROR: $REAL_USER cannot execute sandboxed systemd-run as brain-sandbox."
    echo "Check /etc/sudoers.d/brain-shell-sandbox and sudo configuration."
    exit 1
fi

# 10. Disable hourly cleanup cron for sandbox home (temporary)
echo "Disabling hourly sandbox cleanup..."
CRON_FILE="/etc/cron.d/brain-sandbox-cleanup"
if [ -f "$CRON_FILE" ]; then
    sudo rm -f "$CRON_FILE"
fi

# ============================================================
# Production-only steps (skipped in --dev mode)
# ============================================================

if [ "$DEV_MODE" = false ]; then

    # Install PM2
    if ! command -v pm2 &> /dev/null; then
        echo "PM2 not found. Installing global PM2..."
        sudo npm install -g pm2
    else
        echo "PM2 is already installed: $(pm2 -v)"
    fi

    # Configure PM2 Log Management
    echo "Configuring PM2 Log Rotation for $REAL_USER..."
    rm -rf /tmp/pm2-logrotate
    sudo -u "$REAL_USER" pm2 install pm2-logrotate || true
    sudo -u "$REAL_USER" pm2 set pm2-logrotate:max_size 10M
    sudo -u "$REAL_USER" pm2 set pm2-logrotate:retain 7
    sudo -u "$REAL_USER" pm2 set pm2-logrotate:compress true
    sudo -u "$REAL_USER" pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

    # Ensure PM2 starts on boot
    echo "Configuring PM2 Startup..."
    sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u "$REAL_USER" --hp "/home/$REAL_USER" || true

    # Install Caddy
    if ! command -v caddy &> /dev/null; then
        echo "Caddy not found. Installing Caddy..."
        sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
        sudo apt update
        sudo apt install -y caddy
    else
        echo "Caddy is already installed: $(caddy version)"
    fi

    # Clone Repository
    if [ ! -d "$APP_DIR" ]; then
        echo "App directory $APP_DIR does not exist. Cloning repository..."
        sudo mkdir -p "$(dirname "$APP_DIR")"
        sudo chown -R "$REAL_USER":"$REAL_USER" "$(dirname "$APP_DIR")"
        git clone "$REPO_URL" "$APP_DIR"
        echo "Repository cloned."
    else
        echo "App directory exists at $APP_DIR. Skipping clone."
    fi

    # Setup Caddyfile
    echo "Configuring Caddy for $HOSTNAME..."
    sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
$HOSTNAME {
    reverse_proxy localhost:3000
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
EOF
    echo "Reloading Caddy..."
    sudo systemctl reload caddy

    # SSH Hardening
    echo "Hardening SSH security..."
    if [ -f /etc/ssh/sshd_config ]; then
        sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
        sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
        sudo sed -i 's/^#\?ChallengeResponseAuthentication .*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
        echo "Validating SSH config..."
        if sudo sshd -t; then
            echo "Restarting SSH service..."
            sudo systemctl restart ssh
        else
            echo "ERROR: SSH config is invalid. Restoring backup..."
            sudo cp /etc/ssh/sshd_config.bak /etc/ssh/sshd_config
        fi
    fi

    # Install Fail2Ban
    echo "Installing Fail2Ban..."
    sudo apt install -y fail2ban
    sudo tee /etc/fail2ban/jail.local > /dev/null <<EOF
[DEFAULT]
bantime  = 24h
findtime = 10m
maxretry = 3

[sshd]
enabled = true
EOF
    echo "Restarting Fail2Ban..."
    sudo systemctl restart fail2ban

    # Configure Unattended Upgrades
    echo "Configuring Unattended Upgrades..."
    sudo apt install -y unattended-upgrades
    echo "unattended-upgrades unattended-upgrades/enable_auto_updates boolean true" | sudo debconf-set-selections
    sudo dpkg-reconfigure -f noninteractive unattended-upgrades

    # Configure Firewall (UFW)
    echo "Configuring firewall..."
    sudo apt install -y ufw
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow 22/tcp    # SSH
    sudo ufw allow 80/tcp    # HTTP
    sudo ufw allow 443/tcp   # HTTPS
    sudo ufw --force enable

    # Final Permission Fix
    echo "Ensuring file ownership for $REAL_USER..."
    sudo chown -R "$REAL_USER":"$REAL_USER" "$APP_DIR"

fi

echo ""
echo "Setup completed successfully!"
if [ "$DEV_MODE" = true ]; then
    echo "Dev environment is ready. Run 'npm run dev' to start."
fi
