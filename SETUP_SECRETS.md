# Setting Up Secrets & Configuration

Complete guide to configure GitHub Secrets, environment variables, and external services.

## GitHub Secrets (For GitHub Actions)

GitHub Actions uses secrets to securely store sensitive values. These are used by CI/CD workflows but NOT for local development.

### How to Add Secrets

1. Go to your repository on GitHub
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Enter Name and Value
5. Click "Add secret"

### Secrets for Docker Hub (Optional)

If you want images pushed to Docker Hub:

| Secret Name | Value | Where to Get |
|-------------|-------|--------------|
| `DOCKER_HUB_USERNAME` | Your Docker Hub username | [docker.io](https://hub.docker.com) → login → Account Settings |
| `DOCKER_HUB_TOKEN` | Docker Hub Personal Access Token | Account Settings → Security → New Access Token (select RW) |

**Result:** Images pushed to `docker.io/wandahs/apik` on each release.

### Secrets for Automatic Deployment (Advanced)

If deploying to VPS via Actions:

| Secret Name | Value | Generate |
|-------------|-------|----------|
| `VPS_HOST` | VPS IP or domain | Your VPS provider |
| `VPS_USER` | SSH username | Your VPS (usually `root` or `ubuntu`) |
| `VPS_KEY` | SSH private key | `ssh-keygen -t ed25519` on local machine |

```bash
# Generate SSH key (local machine)
ssh-keygen -t ed25519 -f apik_deploy -C "apik-deploy"
# .pub file → add to `~/.ssh/authorized_keys` on VPS
# Private key → add to GitHub Secrets as VPS_KEY
```

---

## Backend Environment (.env File)

Edit `backend/.env` before running Docker:

```bash
cp backend/.env.template backend/.env
# Edit with your text editor or nano:
nano backend/.env
```

### Clerk Configuration

1. **Create Clerk account:** https://dashboard.clerk.com

2. **Create Application** (if first time):
   - Choose platform: Web
   - Framework: Other (we're using Express backend)

3. **Get API Keys:**
   - Dashboard → API Keys
   - Copy values:
     - `CLERK_SECRET_KEY` (keep private, backend only)
     - `CLERK_PUBLISHABLE_KEY` (can be public, frontend)

4. **Configure CORSУ (Allowed Origins):**
   - Dashboard → Settings → CORS Origins
   - Add: `http://localhost:3001`, `http://localhost:5173` (local dev)
   - Add: `https://api.example.com` (production)

5. **Add to backend/.env:**
   ```bash
   CLERK_SECRET_KEY=your_clerk_secret_key
   CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
   ```

### Supabase Configuration

1. **Create Supabase account:** https://app.supabase.com

2. **Create Project:**
   - Choose region (closest to users)
   - Set strong database password
   - Wait for project to initialize (~2 min)

3. **Initialize Schema:**
   - Go to SQL Editor
   - Click "New query"
   - Paste content of [`supabase/schema.sql`](supabase/schema.sql)
   - Run query

4. **Get API Keys:**
   - Settings → API
   - Copy values:
     - `Project URL` → `SUPABASE_URL`
     - `Service Role Key` → `SUPABASE_SERVICE_ROLE_KEY` (backend only, secret!)

5. **Add to backend/.env:**
   ```bash
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

---

## Frontend Configuration (Optional, for Production)

These are **build-time** variables for Docker image. If you don't set them, frontend runs in guest mode.

In `docker-compose.yml`, add build args:

```yaml
services:
  apik:
    build:
      args:
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_xxx"
        VITE_APP_BASE_URL: "https://api.example.com"
        VITE_API_BASE_URL: "https://api.example.com"
        VITE_WS_BASE_URL: "wss://api.example.com"
```

Or, when building locally:

```bash
docker build \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY="pk_live_xxx" \
  --build-arg VITE_API_BASE_URL="https://api.example.com" \
  .
```

---

## Testing Configuration Locally

### Test 1: Guest Mode (No Config)

```bash
docker compose up -d
# Collections saved in browser local storage only
```

**Access:** http://localhost:3001

**Verify:** Can create collections without login → Guest mode working ✅

### Test 2: With Supabase

```bash
# backend/.env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

docker compose up -d
# Try login (optional) → Collections sync to Supabase
```

**Verify logs:**
```bash
docker compose logs apik | grep -i supabase
```

Should NOT show connection errors.

### Test 3: With Clerk + Supabase

```bash
# backend/.env
CLERK_SECRET_KEY=sk_test_xxx
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

docker compose up -d
```

**Verify:**
1. Open http://localhost:3001
2. See "Sign In" button → Clerk configured ✅
3. Click sign in → Clerk login page loads → Auth working ✅
4. After login, collections sync to Supabase → Sync working ✅

---

## Deployment Checklist

Before deploying to production:

- [ ] Clerk account created and keys added to `backend/.env`
- [ ] Supabase project created and DB initialized
- [ ] Supabase keys added to `backend/.env`
- [ ] CORS origins configured in Clerk Dashboard
- [ ] `.env` file is `.gitignore`'d (never commit credentials!)
- [ ] GitHub Secrets added (if auto-deploying)
- [ ] Docker image builds successfully: `docker compose build`
- [ ] Container starts without errors: `docker compose up -d`
- [ ] Health check passes: `curl http://localhost:3001/health`
- [ ] Can access frontend: http://localhost:3001 (200 OK)
- [ ] Database connection works: can see collections after login
- [ ] HTTPS certificate installed (production)

---

## Troubleshooting

### "Clerk webhook signature verification failed"

- Verify `CLERK_SECRET_KEY` is correct
- Check Clerk Dashboard shows your app
- Restart container: `docker compose restart apik`

### "Supabase connection refused"

- Verify `SUPABASE_URL` format: `https://xxx.supabase.co`
- Check database password is correct
- Ping from container: `docker exec apik curl $SUPABASE_URL`
- Verify network connectivity (if behind firewall)

### "Collections not syncing"

- Verify Supabase tables exist: `SELECT table_name FROM information_schema.tables;`
- Check schema initialized: `SELECT * FROM apix_collections;` (should be empty or have data)
- Verify auth token valid: Check logs for Supabase auth errors

### "CORS errors in browser console"

- Add domain to Clerk CORS Origins
- Frontend build args match backend URL
- WebSocket URL matches API base URL

### "Port 3001 already in use"

```bash
# Find process
lsof -i :3001

# Kill process or run on different port
docker compose -e PORT=3002 up -d
```

---

## Security Checklist

- [ ] `.env` files in `.gitignore`
- [ ] Never paste `.env` content in chat/issues
- [ ] Rotate Clerk and Supabase keys periodically (every 6 months recommended)
- [ ] Use strong database password (Supabase)
- [ ] Restrict GitHub Actions to safe branches (`main` and `develop` only)
- [ ] Use HTTPS in production
- [ ] Set `HOST=127.0.0.1` if behind reverse proxy (not exposed to internet)

---

## Quick Reference

### Copy template
```bash
cp backend/.env.template backend/.env
```

### Edit with values
```bash
nano backend/.env
```

### Run locally
```bash
docker compose up -d --build
```

### View logs
```bash
docker compose logs -f apik
```

### Stop
```bash
docker compose down
```

---

For more details, see [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md)
