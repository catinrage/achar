import type { GenerationResult } from '../rpc';
import { m } from './messages/fa';

export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${faDigits(Math.max(1, Math.round(milliseconds)))} میلی‌ثانیه`;
  }
  const seconds = (milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1);
  return `${faDigits(seconds)} ثانیه`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${faDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) {
    return `${faDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
  }
  return `${faDigits((bytes / 1024 / 1024).toFixed(1))} مگابایت`;
}

export function parityLabel(value: GenerationResult | undefined): string {
  if (!value || value.matched === undefined) return m.parityNotRun;
  const problems =
    (value.different ?? 0) +
    (value.missingGenerated ?? 0) +
    (value.missingReference ?? 0);
  return problems === 0
    ? `${faDigits(value.matched)} ${m.parityMatched}`
    : `${faDigits(problems)} ${m.parityIssues}`;
}

export function severityLabel(severity: string): string {
  if (severity === 'error') return m.severityError;
  if (severity === 'warning') return m.severityWarning;
  return m.severityInfo;
}
