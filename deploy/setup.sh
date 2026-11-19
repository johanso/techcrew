#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 VPS for TechTeam: updates, firewall, swap, Docker and gVisor (the runtime agent
# sandboxes run under). Idempotent: run it again after a change, and run it as-is on the next VPS.
#
#   bash setup.sh              base setup (as root)
#   bash setup.sh --lock-ssh   also turn off password and root logins; only after `ssh techteam@<ip>` works with a key
set -euo pipefail

APP_USER=techteam
SWAP_SIZE=4G

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
. /etc/os-release
[ "$VERSION_ID" = "24.04" ] || echo "Warning: written for Ubuntu 24.04, this is $PRETTY_NAME."

export DEBIAN_FRONTEND=noninteractive
step() { printf '\n==> %s\n' "$1"; }

step "System updates"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades
timedatectl set-timezone UTC
dpkg-reconfigure -f noninteractive unattended-upgrades

# Builds and headless browsers peak above 8 GB of RAM; swap turns that into slowness instead of the OOM killer.
step "Swap ($SWAP_SIZE)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-techteam.conf
sysctl -q -p /etc/sysctl.d/99-techteam.conf

step "Firewall: SSH, HTTP and HTTPS only"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

step "Docker Engine"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Published ports skip ufw (Docker writes its own iptables rules), so they bind to localhost unless a service asks
# for 0.0.0.0 explicitly (only the reverse proxy will). Logs are capped so a chatty container can't fill the disk.
step "Docker daemon settings"
cat > /etc/docker/daemon.json <<'EOF'
{
  "ip": "127.0.0.1",
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF

# Agent sandboxes run untrusted code (the repo's and the agents'): gVisor gives each one its own user-space kernel.
step "gVisor (runsc)"
if ! command -v runsc >/dev/null; then
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  apt-get update -q
  apt-get install -yq runsc
fi
runsc install
systemctl restart docker
docker run --rm --runtime=runsc hello-world >/dev/null && echo "gVisor runtime works."
# The sandbox image (SANDBOX_IMAGE in the app), pulled now so an agent's first call doesn't wait for it.
docker pull --quiet node:24-bookworm

# The app (and Docker over SSH from a dev machine) connects as this user, never as root. The docker group is
# root-equivalent anyway, so passwordless sudo adds nothing an attacker with this account wouldn't already have.
step "User $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
usermod -aG docker,sudo "$APP_USER"
echo "$APP_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$APP_USER"
chmod 440 "/etc/sudoers.d/$APP_USER"
visudo -cf "/etc/sudoers.d/$APP_USER" >/dev/null
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/authorized_keys "/home/$APP_USER/.ssh/authorized_keys"
fi

systemctl enable --now fail2ban >/dev/null

if [ "${1:-}" = "--lock-ssh" ]; then
  # sshd keeps the first value it reads, and this file sorts before the provider's 50-cloud-init.conf.
  step "SSH: keys only, no root login"
  cat > /etc/ssh/sshd_config.d/10-techteam.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  sshd -t
  systemctl reload ssh
fi

step "Done"
docker --version
runsc --version | head -1
ufw status | head -1
echo "fail2ban: $(systemctl is-active fail2ban)"
