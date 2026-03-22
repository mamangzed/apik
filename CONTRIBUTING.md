# Contributing to APIK

Thanks for your interest in contributing to APIK! This guide will help you get started.
## Documentation

Before starting, you may find these guides helpful:

- **[SETUP_SECRETS.md](SETUP_SECRETS.md)** — How to configure services (Clerk, Supabase, etc.)
- **[DOCKER_DEPLOY.md](DOCKER_DEPLOY.md)** — Full Docker deployment guide with examples
- **[CHANGELOG.md](CHANGELOG.md)** — Version history and breaking changes
## Development Setup

### Prerequisites
- Node.js 20+
- npm or yarn
- Docker (optional, for containerized development)

### Quick Start

1. **Clone and install**
   ```bash
   git clone https://github.com/yourusername/apik.git
   cd apik
   npm run install:all
   ```

2. **Configure environment**
   ```bash
   cp backend/.env.template backend/.env
   cp frontend/.env.template frontend/.env
   ```
   Fill in any required values (optional - app works in guest mode).

3. **Start development**
   ```bash
   npm run dev
   ```
   - Backend: http://localhost:3001
   - Frontend: http://localhost:5173

### Docker Development

For containerized development:

```bash
docker compose up -d --build
```

Access: http://localhost:3001

View logs:
```bash
docker compose logs -f apik
```

See [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md) for environment configuration and troubleshooting.

## Code Organization

```
apik/
├── backend/          TypeScript + Express + WebSocket
│  ├── src/index.ts  Entry point
│  ├── src/routes/   API routes
│  ├── src/lib/      Business logic (proxy, intercept, etc.)
│  └── src/storage/  Data persistence
├── frontend/         React + Vite + TypeScript
│  ├── src/          Components, store, utils
│  └── src/types/    Shared types
├── extension/        Chrome/Firefox MV3 extension
└── supabase/        Database schema
```

## Making Changes

### Backend Changes
- Add new routes in `backend/src/routes/`
- Add business logic in `backend/src/lib/`
- TypeScript strict mode is enforced
- Run `npm run build` in backend to type-check

### Frontend Changes
- Add components in `frontend/src/components/`
- Use Zustand for state management (`frontend/src/store/`)
- Tailwind CSS for styling
- Monaco Editor for code display
- Run `npm run build` in frontend to validate

### Database Schema
- Edit `supabase/schema.sql` for schema changes
- Run migrations in your Supabase project

## Testing

Currently, tests are not enforced but contributions with tests are appreciated.

```bash
# Run type checking
npm run build
```

## Submitting Changes

1. **Fork and branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make commits**
   - Use clear, descriptive commit messages
   - Keep commits atomic (one feature per commit)

3. **Test locally**
   ```bash
   npm run build
   npm run dev
   ```

4. **Push and create a Pull Request**
   - Describe what your change does
   - Reference any related issues
   - Include screenshots for UI changes

## Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Update README if adding new features
- Test in both browser and extension (if applicable)
- Ensure no console errors or warnings

## Release Process

Releases follow semantic versioning (major.minor.patch):

1. Update version in:
   - Root `package.json`
   - `backend/package.json`
   - `frontend/package.json`

2. Add entry to CHANGELOG (if maintainer creates one)

3. Commit: `git commit -m "chore: bump to vX.Y.Z"`

4. Tag: `git tag vX.Y.Z`

5. Push: `git push origin main --tags`

GitHub Actions will automatically:
- Build Docker image
- Push to Docker Hub with version tag
- Create GitHub release

## Docker Registry

Images are published to `docker.io/wandahs/apik`:

```bash
docker pull wandahs/apik:latest
docker pull wandahs/apik:vX.Y.Z
```

## Questions?

- Check existing issues for similar questions
- Ask in a new issue with the `question` label
- See README.md for more usage info

## Code of Conduct

Be respectful and constructive. This is a community project.

---

Happy contributing!
