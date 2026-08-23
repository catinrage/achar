import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { registerDefaultPost } from './default-post';
import { Parser } from './parser';
import { Program } from './program';

describe('Default post', () => {
  it('registers handlers for every production event observed in fixtures', () => {
    const program = new Program({ programName: 'CoverageProbe' });
    const registeredEvents = new Set<string>();
    const originalOn = program.on.bind(program);

    program.on = ((eventName, listener) => {
      registeredEvents.add(String(eventName));
      return originalOn(eventName, listener);
    }) as Program['on'];

    registerDefaultPost(program);

    const fixtureRoot = path.join(__dirname, '../../../../fixtures');
    const observedEvents = new Set<string>();

    for (const entry of readdirSync(fixtureRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const fixtureDir = path.join(fixtureRoot, entry.name);
      const manifestPath = path.join(fixtureDir, 'achar.fixture.json');
      // Directories without a manifest (e.g. a fixture being prepared)
      // must not break unrelated coverage checks.
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        trace: string;
      };
      // This check only needs the set of event names, so it scans for them
      // instead of parsing hundreds of megabytes of fixture traces into event
      // objects it would immediately discard.
      const events = new Parser(
        readFileSync(path.join(fixtureDir, manifest.trace), 'utf8'),
      ).scanEventNames();

      for (const eventName of events) {
        if (
          eventName.startsWith('Usr') ||
          [
            'Cycle832',
            'InchSystem',
            'Initiate',
            'Settings',
            'StartTool',
          ].includes(eventName)
        ) {
          continue;
        }
        observedEvents.add(eventName);
      }
    }

    expect([...registeredEvents].sort()).toEqual(
      expect.arrayContaining([...observedEvents].sort()),
    );
  }, 15_000);
});
