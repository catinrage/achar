import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
      const manifest = JSON.parse(
        readFileSync(path.join(fixtureDir, 'achar.fixture.json'), 'utf8'),
      ) as { trace: string };
      const events = new Parser(
        readFileSync(path.join(fixtureDir, manifest.trace), 'utf8'),
      )
        .parse()
        .map((event) => String(event._eventName));

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
