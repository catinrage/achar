/**
 * Display formatting.
 *
 * Numbers are rendered with Persian digits throughout. That is not decoration:
 * the rest of the page is Persian, and Latin digits inside an RTL line break
 * the reading order in a way that is genuinely harder to scan.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function faDigits(value: string | number): string {
  return String(value).replace(
    /\d/g,
    (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${faDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) {
    return `${faDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
  }
  return `${faDigits((bytes / 1024 / 1024).toFixed(1))} مگابایت`;
}

export function formatMilliseconds(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${faDigits(Math.max(1, Math.round(milliseconds)))} میلی‌ثانیه`;
  }
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${faDigits(seconds.toFixed(1))} ثانیه`;
  const minutes = Math.floor(seconds / 60);
  return `${faDigits(minutes)} دقیقه و ${faDigits(Math.round(seconds % 60))} ثانیه`;
}

/**
 * Renders core's `H:MM:SS` cycle-time strings as Persian prose.
 *
 * Falls back to the raw value rather than guessing when the shape is not the
 * one core produces — a wrong cycle time is worse than an unstyled one.
 */
export function formatCycleTime(duration: string | undefined): string {
  if (!duration) return '—';
  const match = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(duration.trim());
  if (!match) return faDigits(duration);

  const [, hours, minutes] = match;
  const parts: string[] = [];
  if (Number(hours) > 0) parts.push(`${faDigits(Number(hours))} ساعت`);
  if (Number(minutes) > 0) parts.push(`${faDigits(Number(minutes))} دقیقه`);
  if (parts.length === 0) return `کمتر از ${faDigits(1)} دقیقه`;
  return parts.join(' و ');
}

const dateFormat = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatWhen(timestamp: number): string {
  return dateFormat.format(new Date(timestamp));
}

export function formatNumber(value: number, digits = 0): string {
  return faDigits(value.toFixed(digits));
}

/**
 * Formats the post's own timestamp, which carries no timezone.
 *
 * It is the posting machine's wall clock, so it is read as local time rather
 * than shifted. A stamp the post wrote in a shape we cannot parse is shown
 * verbatim: the operator can still compare it against SolidCAM by eye, which
 * is the whole point of showing it.
 */
export function formatPostedAt(postedAt: {
  raw: string;
  iso?: string;
}): string {
  if (postedAt.iso === undefined) return postedAt.raw;
  const parsed = new Date(postedAt.iso);
  return Number.isNaN(parsed.getTime())
    ? postedAt.raw
    : dateFormat.format(parsed);
}
