import type { EventsType } from '../types';
import type { EventData } from './parser';

export type PostLintRule =
  | 'no-raw-put'
  | 'no-duplicate-handler'
  | 'no-controller-command-outside-driver'
  | 'no-positional-cycle'
  | 'unhandled-event';

export interface PostLintIssue {
  rule: PostLintRule;
  line: number;
  message: string;
}

export interface PostLintOptions {
  driverFile?: boolean;
}

export function lintPostSource(
  source: string,
  options: PostLintOptions = {},
): PostLintIssue[] {
  const issues: PostLintIssue[] = [];
  const handlers = new Map<string, number>();
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/\$\.put\s*\(/.test(line)) {
      issues.push({
        rule: 'no-raw-put',
        line: lineNumber,
        message:
          'Use typed Builder helpers or a controller driver instead of $.put().',
      });
    }
    if (!options.driverFile && /['"`]CYCLE\d+\s*\(/.test(line)) {
      issues.push({
        rule: 'no-controller-command-outside-driver',
        line: lineNumber,
        message: 'Controller cycle strings belong in a typed driver.',
      });
    }
    if (/\.Cycle\d+\s*\(\s*[^\s{]/.test(line)) {
      issues.push({
        rule: 'no-positional-cycle',
        line: lineNumber,
        message: 'Pass a named parameter object to cycle helpers.',
      });
    }
    const handler = line.match(/\.on\(\s*['"]([^'"]+)['"]/i)?.[1];
    if (handler) {
      const previous = handlers.get(handler);
      if (previous !== undefined) {
        issues.push({
          rule: 'no-duplicate-handler',
          line: lineNumber,
          message: `Handler '${handler}' was already registered on line ${previous}.`,
        });
      } else {
        handlers.set(handler, lineNumber);
      }
    }
  });

  return issues;
}

export function formatPostLintIssues(issues: PostLintIssue[]): string {
  return issues.length === 0
    ? 'Post lint passed'
    : issues
        .map((issue) => `${issue.line}: ${issue.rule}: ${issue.message}`)
        .join('\n');
}

export function lintUnhandledEvents(
  events: EventData[],
  handled: readonly (keyof EventsType)[],
): PostLintIssue[] {
  const handledNames = new Set<string>(handled);
  return [
    ...new Set(
      events
        .filter((event) => event._depth === undefined || event._depth <= 1)
        .map((event) => String(event._eventName)),
    ),
  ]
    .filter((event) => !handledNames.has(event))
    .sort()
    .map((event) => ({
      rule: 'unhandled-event' as const,
      line: 0,
      message: `Trace event '${event}' has no registered handler.`,
    }));
}
