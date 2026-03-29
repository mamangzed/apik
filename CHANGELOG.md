# Changelog

All notable changes to APIK are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.3.1] - 2026-03-29

### Added
- Flow preview enhancements in intercept mapping: horizontal/vertical layouts, edge colors by response status, and global flow chaining
- Flow preview controls: compact mode, show host, only matched, and reset layout
- Rich flow tooltips (full URL, status, response time, payload size)

### Changed
- Flow preview layout preference now persists per user and collection

### Fixed
- Mapping modal source match list rendering and JSX corruption in intercept panel

---

## [1.2.0] - 2026-03-29

### Added
- New `apik` scripting runtime for pre-request and post-request scripts
- Rich scripting helpers: `apik.env`, `apik.request`, `apik.response`, `apik.test`, `apik.expect`
- Post-request assertion summary in response viewer (pass/fail with error detail)
- Dedicated scripting documentation in `SCRIPTING.md`

### Changed
- Script editor examples now use `apik` naming and clearer pre/post request usage
- Request tabs now label script phase as `Post-Request` for better UX clarity
- Version bumped to `1.2.0` (root, frontend, backend)

### Fixed
- Query param mutation in script runtime now safely supports relative URLs
- Better script execution flow consistency between single send and collection run

---

## [1.1.1] - 2026-03-25

### Added
- Collection export actions in sidebar (APIK, Postman, OpenAPI)
- Auto-detect import mode in collection import modal

### Changed
- Import modal now uses unified collection parser and supports JSON/YAML/HAR uploads
- Backend import endpoint now supports auto/apik/postman/openapi/insomnia/har formats

### Fixed
- Format mismatch between apix and apik import labels
- Loss of request fields during import by improving parser normalization for params, headers, body, and auth
- Added backend import guardrails and validation for production safety


### Added
- Initial Docker support with GitHub Actions CI/CD
- Template environment files (.env.template) for easier setup
- Contributing guidelines and issue templates
- Pre-built Docker images published to Docker Hub

### Changed
- Improved documentation for open-source deployment

### Fixed
- iptables warning in Docker containers

---

## [1.1.0] - 2026-03-23

### Features
- Full-featured API client with request builder
- Collection management with import support
- Browser extension for request interception (Chrome/Firefox MV3)
- Environment variables and secrets management
- Pre-request and test scripts
- Public and private sharing links
- Mobile proxy intercept with WireGuard support
- Supabase sync for cross-device collections
- API documentation generation

---

[Unreleased]: https://github.com/mamangzed/apik/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/mamangzed/apik/releases/tag/v1.3.1
[1.2.0]: https://github.com/mamangzed/apik/releases/tag/v1.2.0
[1.1.1]: https://github.com/mamangzed/apik/releases/tag/v1.1.1
[1.1.0]: https://github.com/mamangzed/apik/releases/tag/v1.1.0
