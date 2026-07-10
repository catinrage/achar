import { definePostPolicy } from '../../lib/post-policy';
import type { EventsType } from '../../types';

export const siemens828dPolicy = definePostPolicy({
  formatNumber(value: number): string {
    return Number.isInteger(value)
      ? value.toString()
      : value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
  },

  formatRotary(value: number): string {
    return Number.isInteger(value)
      ? `${value}.`
      : siemens828dPolicy.formatNumber(value);
  },

  sameNumber(left: number | undefined, right: number | undefined): boolean {
    return (
      left !== undefined &&
      right !== undefined &&
      Math.abs(left - right) < 0.000001
    );
  },

  sameRapidNumber(
    left: number | undefined,
    right: number | undefined,
  ): boolean {
    return (
      left !== undefined &&
      right !== undefined &&
      Math.abs(left - right) <= 0.000011
    );
  },

  traceChanged(params: object, key: string): boolean | undefined {
    const value = (params as Record<string, unknown>)[`${key}__changed`];
    return typeof value === 'boolean' ? value : undefined;
  },

  jobFileName(params: EventsType['StartOfJob']): string {
    return params.original_job_name || params.job_name;
  },

  isDrillJob(params: EventsType['StartOfJob']): boolean {
    return params.job_type.includes('drill');
  },

  cycleTolerance(params: EventsType['StartOfJob'], current: number): number {
    let tolerance = params.Cut_tolerance ?? current;
    if (tolerance === 0) tolerance = 0.1;
    if (params.job_type === 'profile') tolerance = 0.003;
    return tolerance;
  },

  cycle832Mode(tolerance: number): '_ROUGH' | '_SEMIFIN' | '_FINISH' {
    if (tolerance >= 0.1) return '_ROUGH';
    if (tolerance > 0.05) return '_SEMIFIN';
    return '_FINISH';
  },
});
