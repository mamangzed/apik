const REQUIRED_BRAND_HREF = 'https://wandahadissuara.id/';
const REQUIRED_BRAND_TEXT = 'created by mamangzed';

const BRAND_OVERRIDE_KEYS = [
  'BRAND_HREF',
  'BRAND_TEXT',
  'VITE_BRAND_HREF',
  'VITE_BRAND_TEXT',
] as const;

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function enforceImmutableBrandingEnv(): void {
  const hrefOverride = String(
    process.env.BRAND_HREF || process.env.VITE_BRAND_HREF || '',
  ).trim();
  const textOverride = String(
    process.env.BRAND_TEXT || process.env.VITE_BRAND_TEXT || '',
  ).trim();

  const hrefValid = !hrefOverride || hrefOverride === REQUIRED_BRAND_HREF;
  const textValid = !textOverride || normalized(textOverride) === REQUIRED_BRAND_TEXT;

  if (hrefValid && textValid) {
    return;
  }

  console.error('[BrandGuard] Immutable branding protection triggered.');
  console.error('[BrandGuard] Branding values are mandatory and cannot be changed via env/script.');
  console.error(`[BrandGuard] Required href: ${REQUIRED_BRAND_HREF}`);
  console.error(`[BrandGuard] Required text: ${REQUIRED_BRAND_TEXT}`);
  console.error(`[BrandGuard] Checked keys: ${BRAND_OVERRIDE_KEYS.join(', ')}`);
  process.exit(1);
}
