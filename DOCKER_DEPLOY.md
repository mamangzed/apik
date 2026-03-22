# Docker Install and Server Deployment Guide

This guide covers three scenarios for APIK:

1. Run locally with Docker
2. Deploy to personal VPS manually
3. Deploy to personal VPS using shell script automation

---

## 1. Prerequisites

- Git
- Docker Engine 24+ and Docker Compose plugin
- Open ports on server:
  - 2611 (APIK app)
  - 8080 (intercept proxy)
  - 80 and 443 (if using reverse proxy/HTTPS)

For production with full features (optional):

- Clerk project (CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY)
- Supabase project (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

---

## 2. Install Docker

### Ubuntu / Debian

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

Re-login after adding user to docker group.

Verify:

```bash
docker --version
docker compose version
```

---

## 2.1 One-Command Deploy (Docker Compose)

If you want the fastest setup without cloning repository, use this one command:

```bash
docker run -d --name apik --restart unless-stopped -p 2611:2611 -p 8080:8080 --cap-add NET_ADMIN -v apik-data:/app/backend/data wandahs/apik:latest
```

One-command auto-pull + Clerk + Supabase env setup (no git clone):

```bash
docker run --pull always -d --name apik --restart unless-stopped -p 2611:2611 -p 8080:8080 --cap-add NET_ADMIN -v apik-data:/app/backend/data -e CLERK_SECRET_KEY='your_clerk_secret_key' -e CLERK_PUBLISHABLE_KEY='your_clerk_publishable_key' -e SUPABASE_URL='https://your-project.supabase.co' -e SUPABASE_SERVICE_ROLE_KEY='your_supabase_service_role_key' wandahs/apik:latest
```

If container already exists, recreate in one command:

```bash
docker rm -f apik 2>/dev/null || true ; docker run --pull always -d --name apik --restart unless-stopped -p 2611:2611 -p 8080:8080 --cap-add NET_ADMIN -v apik-data:/app/backend/data -e CLERK_SECRET_KEY='your_clerk_secret_key' -e CLERK_PUBLISHABLE_KEY='your_clerk_publishable_key' -e SUPABASE_URL='https://your-project.supabase.co' -e SUPABASE_SERVICE_ROLE_KEY='your_supabase_service_role_key' wandahs/apik:latest
```

Note: Clerk and Supabase services/accounts are not auto-created by Docker. The command above auto-wires your existing keys into APIK.

Then open:

- http://YOUR_SERVER_IP:2611

If you want to build from source with one command, use this:

```bash
git clone https://github.com/mamangzed/apik.git && cd apik && cp backend/.env.example backend/.env && docker compose up -d --build
```

Then open:

- http://YOUR_SERVER_IP:2611

One-command update on existing server:

```bash
cd apik && git pull && docker compose up -d --build
```

---

## 3. Run APIK with Docker (Local or Server)

### 3.1 Clone repository

```bash
git clone https://github.com/mamangzed/apik.git
cd apik
```

### 3.2 Prepare environment

```bash
cp backend/.env.example backend/.env
```

Edit backend/.env and fill only what you need. APIK can run in guest mode with defaults.

### 3.3 Build and start

```bash
docker compose up -d --build
```

### 3.4 Verify service

```bash
docker compose ps
docker compose logs -f apik
```

Access app:

- http://localhost:2611 (local)
- http://YOUR_SERVER_IP:2611 (server)

Stop service:

```bash
docker compose down
```

---

## 4. Manual VPS Deployment (Production Style)

This section is for deploying manually without the automation script.

### 4.1 Prepare VPS

```bash
sudo apt-get update
sudo apt-get install -y git ufw
```

Allow required ports:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 2611/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 4.2 Deploy app

```bash
git clone https://github.com/mamangzed/apik.git
cd apik
cp backend/.env.example backend/.env
nano backend/.env

docker compose up -d --build
```

### 4.3 Update deployment

```bash
cd apik
git pull
docker compose up -d --build
```

### 4.4 Health checks

```bash
curl -I http://127.0.0.1:2611
docker compose ps
docker compose logs --tail=100 apik
```

---

## 5. Automated VPS Deployment with Script (.sh)

Use this when you want Nginx + HTTPS + systemd + Cloudflare handled automatically.

Script files:

- deploy_cloudflare_vps.sh
- manage_vps.sh

### 5.1 Interactive mode

```bash
chmod +x deploy_cloudflare_vps.sh manage_vps.sh
sudo bash ./deploy_cloudflare_vps.sh
```

The script will prompt for required values and automatically:

- Install dependencies (Node.js, Nginx, tools)
- Build backend and frontend
- Create backend env and frontend env
- Create systemd service (apik-backend)
- Configure Nginx reverse proxy + WebSocket
- Configure Cloudflare origin cert and strict SSL

### 5.2 Non-interactive mode

```bash
sudo env \
  DOMAIN='api.example.com' \
  PROXY_SUBDOMAIN='proxy' \
  CF_API_TOKEN='your_cloudflare_api_token' \
  CF_ZONE_ID='your_cloudflare_zone_id' \
  CLERK_SECRET_KEY='your_clerk_secret_key' \
  CLERK_PUBLISHABLE_KEY='your_clerk_publishable_key' \
  SUPABASE_URL='https://your-project.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='your_supabase_service_role_key' \
  bash ./deploy_cloudflare_vps.sh
```

### 5.3 Manage running service

```bash
./manage_vps.sh status
./manage_vps.sh restart
./manage_vps.sh logs
```

---

## 6. Optional: Use Prebuilt Docker Hub Image

```bash
docker pull wandahs/apik:latest

docker run -d \
  --name apik \
  --restart unless-stopped \
  -p 2611:2611 \
  -p 8080:8080 \
  --cap-add NET_ADMIN \
  -v apik-data:/app/backend/data \
  --env-file backend/.env \
  wandahs/apik:latest
```

### 6.1 Push Image to Docker Hub Manually (Docker CLI)

If you want to publish image manually with Docker command like `docker push wandahs/apik:tagname`, use this flow:

```bash
# 1) Build image from current project
docker build -t apik:local .

# 2) Tag image for Docker Hub
docker tag apik:local wandahs/apik:tagname

# 3) Login to Docker Hub
docker login

# 4) Push image
docker push wandahs/apik:tagname
```

Push multiple tags (recommended):

```bash
docker tag apik:local wandahs/apik:latest
docker tag apik:local wandahs/apik:v1.1.0
docker push wandahs/apik:latest
docker push wandahs/apik:v1.1.0
```

Verify image exists on Docker Hub:

```bash
docker pull wandahs/apik:tagname
```

---

## 7. Troubleshooting

### Build error: backend/data not found

Already fixed in Dockerfile. Pull latest and rebuild:

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

### App not reachable on VPS

Check:

```bash
docker compose ps
sudo ss -ltnp | grep -E ':2611|:8080|:80|:443'
sudo ufw status
```

---

## 8. Security Notes

- Do not commit backend/.env
- Keep keys in environment/secrets manager
- For public OSS images, use least-privilege credentials
- Use HTTPS in production
