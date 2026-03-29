# APIK Scripting Guide

This guide explains how to use JavaScript scripting in APIK for both:

- Pre-request scripts
- Post-request scripts

APIK uses `apik` as the script runtime object.

## Script Lifecycle

1. Pre-request script runs before request is sent.
2. Request is sent.
3. Post-request script runs after response is received.

Both scripts can read/write environment variables via `apik.env`.

## Runtime Object

### `apik.env`

- `apik.env.get(key)` -> get environment value
- `apik.env.set(key, value)` -> set environment value
- `apik.env.unset(key)` -> remove environment value
- `apik.env.has(key)` -> check key exists
- `apik.env.all()` / `apik.env.toObject()` -> dump all active env values
- `apik.env.replaceIn(text)` -> replace `{{var}}` placeholders

### `apik.request`

Available in pre-request and post-request script.

- `apik.request.method` (get/set)
- `apik.request.url` (get/set)
- `apik.request.body` (get/set)
- `apik.request.headers` (object)
- `apik.request.getHeader(name)`
- `apik.request.setHeader(name, value)`
- `apik.request.removeHeader(name)`
- `apik.request.setBody(value)`
- `apik.request.appendQueryParam(key, value)`
- `apik.request.setQueryParam(key, value)`
- `apik.request.removeQueryParam(key)`
- `apik.request.toJSON()`

### `apik.response`

Available in post-request script.

- `apik.response.status`
- `apik.response.statusText`
- `apik.response.headers`
- `apik.response.body`
- `apik.response.time`
- `apik.response.size`
- `apik.response.text()`
- `apik.response.json()`
- `apik.response.header(name)`

### Assertions and tests

- `apik.test(name, fn)`
- `apik.expect(value)` matchers:
  - `toBe(expected)`
  - `toEqual(expected)`
  - `toContain(text)`
  - `toMatch(regexOrText)`
  - `toBeTruthy()`
  - `toBeFalsy()`
  - `toBeDefined()`
  - `toBeUndefined()`
  - `toBeNull()`
  - `toBeGreaterThan(n)`
  - `toBeGreaterThanOrEqual(n)`
  - `toBeLessThan(n)`
  - `toBeLessThanOrEqual(n)`

### Utility helpers

- `apik.log(...args)`
- `apik.assert(condition, message)`
- `apik.json()` (alias for `apik.response.json()`)

## Pre-request Example

```javascript
const ts = Date.now().toString();
apik.env.set('timestamp', ts);

const token = apik.env.get('token');
if (token) {
  apik.request.setHeader('Authorization', `Bearer ${token}`);
}

apik.request.setQueryParam('trace_id', ts);
apik.log('Pre-request prepared', apik.request.toJSON());
```

## Post-request Example

```javascript
apik.test('Status is 200', () => {
  apik.expect(apik.response.status).toBe(200);
});

apik.test('Response time < 1000ms', () => {
  apik.expect(apik.response.time).toBeLessThan(1000);
});

const data = apik.response.json();
if (data?.token) {
  apik.env.set('next_token', data.token);
}
```

## Notes

- Script errors are captured and reported in request result.
- Failed assertions in post-request script are reported as post-request failures.
- Environment values changed by script are persisted to active environment.
- APIK keeps backward compatibility aliases (`apix`, `pm`) that map to the same runtime object.
