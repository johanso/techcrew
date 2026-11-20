#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 VPS for TechTeam: updates, firewall, swap, Docker, gVisor (the runtime agent
# sandboxes run under) and Caddy (HTTPS for previews). Idempotent: run it again after a change, and as-is on the next VPS.
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
# Containers never reach the host's own services: SSH (allowed above from anywhere) and whatever else listens
# answered on every Docker bridge's gateway and on the public IP from inside a container. Traffic arriving from a
# bridge (docker0, br-<id>) is refused after the established-connections rule; a container's traffic to the internet
# is forwarded, not input, so installs still work, and SSH from outside comes in on the public interface.
if ! grep -q '^# techteam: containers' /etc/ufw/before.rules; then
  sed -i '/^-A ufw-before-input -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT$/a\
# techteam: containers never reach the host'"'"'s services\
-A ufw-before-input -i docker0 -j REJECT\
-A ufw-before-input -i br-+ -j REJECT' /etc/ufw/before.rules
fi
grep -q '^-A ufw-before-input -i br-+ -j REJECT$' /etc/ufw/before.rules || { echo "Couldn't add the container rules to /etc/ufw/before.rules."; exit 1; }
ufw --force enable
ufw reload >/dev/null

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

# Previews (Settings → Sandbox → Previews) are served at https://pr-<n>-<random>.<SANDBOX_PREVIEW_DOMAIN> by
# caddy-docker-proxy: it routes each host to the preview container labeled with it and gets that host's certificate
# over HTTP-01, so only running previews ever have one. The app connects it to each preview's internal network, where
# it only opens connections to the preview: it listens on its own network's fixed address alone (default_bind), and
# its admin API on its loopback, so a preview (or a browser beside it) finds nothing of Caddy to talk to.
# Its config is the image, the address and the ACME CA; a change recreates it. To try the staging CA first:
#   CADDY_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory bash setup.sh
# Unset, Caddy uses its defaults (Let's Encrypt, then ZeroSSL).
step "Caddy (HTTPS for previews)"
CADDY_NAME=techteam-caddy
CADDY_IMAGE=lucaslorentz/caddy-docker-proxy:2.13.1
CADDY_SUBNET=172.31.254.0/24
CADDY_IP=172.31.254.2
CADDY_CONFIG="$CADDY_IMAGE ip=$CADDY_IP ca=${CADDY_ACME_CA:-default}"
if [ "$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$CADDY_NAME" 2>/dev/null)" != "$CADDY_SUBNET" ]; then
  docker rm --force "$CADDY_NAME" >/dev/null 2>&1 || true
  docker network rm "$CADDY_NAME" >/dev/null 2>&1 || true
  docker network create --subnet "$CADDY_SUBNET" "$CADDY_NAME" >/dev/null
fi
docker volume create "$CADDY_NAME-data" >/dev/null
if [ "$(docker inspect -f '{{index .Config.Labels "techteam.caddy-config"}}' "$CADDY_NAME" 2>/dev/null)" != "$CADDY_CONFIG" ]; then
  # No `caddy` label on this container, so its caddy.* labels are global options.
  CADDY_ARGS=(--label "techteam.caddy-config=$CADDY_CONFIG" --label "caddy.default_bind=$CADDY_IP")
  [ -z "${CADDY_ACME_CA:-}" ] || CADDY_ARGS+=(--label "caddy.acme_ca=$CADDY_ACME_CA")
  docker rm --force "$CADDY_NAME" >/dev/null 2>&1 || true
  # The only service published on every interface (the daemon defaults to 127.0.0.1). The admin API stays on its
  # loopback, so preview containers sharing a network with it can't reconfigure it.
  docker run --detach --name "$CADDY_NAME" --restart=always \
    --publish 0.0.0.0:80:80 --publish 0.0.0.0:443:443 \
    --network "$CADDY_NAME" --ip "$CADDY_IP" \
    --volume /var/run/docker.sock:/var/run/docker.sock:ro \
    --volume "$CADDY_NAME-data:/data" \
    "${CADDY_ARGS[@]}" "$CADDY_IMAGE" >/dev/null
  # A new container lost the old one's networks: rejoin the previews still running.
  for network in $(docker network ls --quiet --filter label=techteam.preview=1); do
    docker network connect "$network" "$CADDY_NAME" 2>/dev/null || true
  done
fi

# Two kinds of sandbox containers have internet, each on its own bridge network: link captures (the sandbox browser,
# lib/sandbox/capture.ts) and the install step of agent sandboxes and previews (unpack + install dependencies,
# lib/sandbox/docker.ts). On both, containers can't talk to each other (icc off). The app creates either network on
# first use with the same shape; this creates them too and recreates one whose shape is wrong (the rules below match
# the subnets). The rules are the private-range layer: traffic from those subnets to private, loopback, link-local
# (cloud metadata), CGNAT, multicast and reserved ranges is refused in DOCKER-USER, the chain Docker leaves to us
# (ufw's own rules never see containers' forwarded traffic). For captures they back up the runner's proxy
# (deploy/browser/net-guard.mjs); for installs they're the only layer, so a dependency's install script can't reach
# the provider's private network. They live in ufw's after.rules, so every `ufw reload` and boot puts them back; Docker
# keeps the chain's contents when it starts. The ufw rule above already refuses traffic from any bridge to the host
# itself. The bridges have no IPv6. Installs resolve names through public resolvers (a resolv.conf the app mounts:
# Docker's embedded DNS doesn't answer under gVisor), which these rules leave alone.
step "Networks with internet: link captures and installs"
ensure_bridge() { # name subnet label
  if [ "$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}} {{index .Options "com.docker.network.bridge.enable_icc"}}' "$1" 2>/dev/null)" != "$2 false" ]; then
    docker network rm "$1" >/dev/null 2>&1 || true
    docker network create --subnet "$2" --opt com.docker.network.bridge.enable_icc=false --label "$3" "$1" >/dev/null
  fi
}
CAPTURE_SUBNET=172.31.253.0/24
INSTALL_SUBNET=172.31.252.0/24
ensure_bridge techteam-capture "$CAPTURE_SUBNET" techteam.capture=1
ensure_bridge techteam-sandbox "$INSTALL_SUBNET" techteam.install-network=1
# The block's first version covered captures only, under its own markers.
sed -i '/^# BEGIN techteam capture$/,/^# END techteam capture$/d' /etc/ufw/after.rules
sed -i '/^# BEGIN techteam private ranges$/,/^# END techteam private ranges$/d' /etc/ufw/after.rules
{
  echo "# BEGIN techteam private ranges"
  echo "*filter"
  echo ":DOCKER-USER - [0:0]"
  for subnet in "$CAPTURE_SUBNET" "$INSTALL_SUBNET"; do
    for range in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 \
      192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
      echo "-A DOCKER-USER -s $subnet -d $range -j REJECT --reject-with icmp-net-prohibited"
    done
  done
  echo "-A DOCKER-USER -j RETURN"
  echo "COMMIT"
  echo "# END techteam private ranges"
} >> /etc/ufw/after.rules
ufw reload >/dev/null
for subnet in "$CAPTURE_SUBNET" "$INSTALL_SUBNET"; do
  iptables -S DOCKER-USER | grep -q -- "-s $subnet -d 169.254.0.0/16" || { echo "The private-range rules for $subnet aren't in DOCKER-USER."; exit 1; }
done

# The app (and Docker over SSH from a dev machine) connects as this user, never as root. The docker group is
# root-equivalent anyway, so passwordless sudo adds nothing an attacker with this account wouldn't already have.
step "User $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
usermod -aG docker,sudo "$APP_USER"
echo "$APP_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$APP_USER"
chmod 440 "/etc/sudoers.d/$APP_USER"
visudo -cf "/etc/sudoers.d/$APP_USER" >/dev/null
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
# Root's keys are added, never copied over: keys added to this user later (another computer) survive a rerun.
if [ -f /root/.ssh/authorized_keys ]; then
  KEYS="/home/$APP_USER/.ssh/authorized_keys"
  install -m 600 -o "$APP_USER" -g "$APP_USER" /dev/null "$KEYS.new"
  [ -f "$KEYS" ] && cat "$KEYS" >> "$KEYS.new"
  while IFS= read -r key; do
    [ -n "$key" ] && ! grep -qxF -- "$key" "$KEYS.new" && printf '%s\n' "$key" >> "$KEYS.new"
  done < /root/.ssh/authorized_keys
  mv "$KEYS.new" "$KEYS"
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
echo "Caddy: $(docker inspect -f '{{.State.Status}}' "$CADDY_NAME") (${CADDY_ACME_CA:-default CA})"
ufw status | head -1
echo "fail2ban: $(systemctl is-active fail2ban)"
