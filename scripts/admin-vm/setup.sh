#!/usr/bin/env bash
set -euo pipefail

# ANASAQ admin VM setup (I19/D27 part 2).
#
# Runs on the Oracle Cloud Always Free Ampere A1 VM itself (arm64, Ubuntu
# 24.04, 1 OCPU / 6 GB, Mumbai): `bash scripts/admin-vm/setup.sh`, as a
# regular sudo-capable user, not as root. Idempotent — safe to re-run after a
# reboot, a partial failure, or to pick up a package update.
#
# Deliberately does NOT touch firewall rules. Oracle's default iptables
# configuration on this image only opens SSH, and Cloudflare Tunnel needs no
# inbound port — the tunnel daemon makes an outbound connection to
# Cloudflare's edge. Nothing here opens a port, and nothing should.

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as a regular sudo user, not as root." >&2
  exit 1
fi

echo "==> apt update/upgrade"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> unattended-upgrades (security patches apply themselves)"
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo systemctl enable --now unattended-upgrades

echo "==> Docker Engine"
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  arch=$(dpkg --print-architecture)
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker already installed, skipping."
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$(whoami)"

echo "==> swap file"
# 6 GB of RAM is tight for an on-VM `docker build` of this app (pnpm install
# plus a Turbopack + TypeScript production build). 8 GB of swap gives the
# build room to finish instead of an OOM kill. This is a starting point, not
# a measured figure — right-size it down once a real build on this VM has
# been measured (docs/admin-vm.md).
swap_file=/swapfile
swap_size_gb=8
if [ ! -f "${swap_file}" ]; then
  sudo fallocate -l "${swap_size_gb}G" "${swap_file}" \
    || sudo dd if=/dev/zero of="${swap_file}" bs=1M count=$((swap_size_gb * 1024))
  sudo chmod 600 "${swap_file}"
  sudo mkswap "${swap_file}"
  sudo swapon "${swap_file}"
else
  echo "${swap_file} already exists, skipping creation."
fi
if ! grep -q "^${swap_file} " /etc/fstab; then
  echo "${swap_file} none swap sw 0 0" | sudo tee -a /etc/fstab > /dev/null
fi

echo "==> done. Log out and back in (or 'newgrp docker') for the docker group to take effect."
