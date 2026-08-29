/**
 * Convert a hex color (#rrggbb or #rgb) to the `H S% L%` triplet used by the
 * shadcn/`--ds-*` CSS variables (e.g. `--primary: 124.4776 55.3719% 23.7255%`).
 * Returns null for malformed input so callers can skip applying a tenant
 * override safely.
 */
export function hexToHslTriplet(hex: string): string | null {
  if (typeof hex !== 'string') return null;
  let value = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(value)) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;

  const int = parseInt(value, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  const format = (n: number) => {
    const rounded = Number(n.toFixed(4));
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  };

  return `${format(h * 360)} ${format(s * 100)}% ${format(l * 100)}%`;
}
