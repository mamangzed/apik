## Support the Project

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Me-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/mamangzed)
[![Saweria](https://img.shields.io/badge/Saweria-Dukung%20Saya-f97316?logo=buymeacoffee&logoColor=white)](https://saweria.co/zedkntl)

# APIK - Web-Based API Client and Interceptor

A modern API client inspired by Bruno, with request interception, environment variables, API documentation, and browser extension support.

[![Live App](https://img.shields.io/badge/Live%20App-apik.app-16a34a?logo=googlechrome&logoColor=white)](https://apik.app/)

[![Docker Build](https://github.com/mamangzed/apik/actions/workflows/docker-build.yml/badge.svg)](https://github.com/mamangzed/apik/actions/workflows/docker-build.yml)
[![Docker Image](https://img.shields.io/badge/docker-dockerhub-blue?logo=docker)](https://hub.docker.com/r/wandahs/apik)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## Why APIK

APIK is built for day-to-day API testing with practical workflows:

- Build requests quickly (REST methods, auth, body, params, headers)
- Organize work in collections and environments
- Run pre-request and test scripts
- Intercept browser traffic with extension + websocket bridge
- Generate and share API docs (public/private)

---

## Features

| Feature | Description |
|---|---|
| Request Builder | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS |
| Auth Support | Bearer, Basic Auth, API Key, OAuth2 |
| Body Types | JSON, XML, Text, Form Data, URL-Encoded, GraphQL |
| Env Variables | Use placeholders like {{base_url}} and {{token}} |
| Scripts | Pre-request scripts and test scripts |
| Intercept Panel | Inspect and manage intercepted requests |
| Share & Docs | Public/private collection and docs links |
| Browser Extension | Chrome, Edge, Firefox support |

---

## Quick Start (Local Development)

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Create env files

```bash
cp backend/.env.template backend/.env
cp frontend/.env.template frontend/.env
```

All env values are optional. APIK works in guest mode without Clerk or Supabase.

### 3. Start application

Windows:

```bat
start.bat
```

Linux/macOS (manual):

```bash
# Terminal 1
cd backend
npm run dev

# Terminal 2
cd frontend
npm run dev
```

### 4. Open app

- Frontend: http://localhost:5173
- Backend: http://localhost:2611

---

## Quick Start (Docker)

One-command deploy without git clone (run prebuilt image):

```bash
docker run -d --name apik --restart unless-stopped -p 2611:2611 -p 8080:8080 --cap-add NET_ADMIN -v apik-data:/app/backend/data wandahs/apik:latest
```

One-command deploy without git clone + auto-pull + Clerk/Supabase env:

```bash
docker run --pull always -d --name apik --restart unless-stopped -p 2611:2611 -p 8080:8080 --cap-add NET_ADMIN -v apik-data:/app/backend/data -e CLERK_SECRET_KEY='your_clerk_secret_key' -e CLERK_PUBLISHABLE_KEY='your_clerk_publishable_key' -e SUPABASE_URL='https://your-project.supabase.co' -e SUPABASE_SERVICE_ROLE_KEY='your_supabase_service_role_key' wandahs/apik:latest
```

One-command deploy from source (with git clone):

```bash
git clone https://github.com/mamangzed/apik.git && cd apik && cp backend/.env.example backend/.env && docker compose up -d --build
```

### 1. Prepare env

```bash
cp backend/.env.example backend/.env
```

### 2. Build and run

```bash
docker compose up -d --build
```

### 3. Access app

- http://localhost:2611

Useful commands:

```bash
docker compose logs -f apik
docker compose down
```

---

## Deploy to Personal Server

There are two official paths:

1. Manual VPS deploy with Docker Compose
2. Automated VPS deploy with shell script

Full tutorial:

- [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md)

---

## Browser Extension Setup

### Chrome / Edge

1. Open chrome://extensions/
2. Enable Developer mode
3. Download apik-extension.zip from APIK header, then extract
4. Click Load unpacked and select extracted folder
5. Set extension values:
   - API Base URL: https://your-domain.example
   - App Base URL: https://your-domain.example
   - WS URL: wss://your-domain.example/ws/intercept
6. Enable Intercept

### Firefox

1. Open about:debugging#/runtime/this-firefox
2. Download and extract apik-extension.zip
3. Click Load Temporary Add-on
4. Select manifest.json

---

## Typical Usage Flow

1. Create request -> method + URL + auth/body
2. Send request -> inspect response
3. Save to collection
4. Use environments for local/staging/prod
5. Add scripts for automation checks
6. Share docs/collections with your team

---

## Troubleshooting

### Port already in use

- Change PORT in backend/.env
- Or stop process using port 2611/5173

### Extension cannot receive events

- Ensure backend is running
- Ensure websocket URL is correct
- Reconnect extension popup

### HTTPS intercept not working

- Install and trust APIK CA certificate
- Certificate-pinned apps may still not be interceptable

---

## Documentation Index

- [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md): Docker install + server deploy (manual and script)
- [SETUP_SECRETS.md](SETUP_SECRETS.md): Clerk, Supabase, GitHub secrets
- [CONTRIBUTING.md](CONTRIBUTING.md): Contribution guide

---

## License

MIT. See [LICENSE](LICENSE).
