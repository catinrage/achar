import { describe, expect, it } from 'vitest';
import { Builder } from './builder';
import { defineDriver } from './driver';
import { createPostContext } from './post-context';
import { definePost } from './post-definition';
import { lintPostSource, lintUnhandledEvents } from './post-lint';
import { definePostPolicy, extendPostPolicy } from './post-policy';
import { expectPost } from './post-test-dsl';
import { Program } from './program';
import { generateVmidTraceTypes, parseVmid } from './vmid';

describe('post authoring DX', () => {
  it('provides resettable typed context and composable policies', () => {
    const context = createPostContext(() => ({ coolant: false, jobs: 0 }));
    context.patch({ coolant: true, jobs: 2 });
    expect(context.state).toEqual({ coolant: true, jobs: 2 });
    expect(context.reset()).toEqual({ coolant: false, jobs: 0 });

    const policy = extendPostPolicy(
      definePostPolicy({ coolant: 'modal' as const }),
      { preselect: true },
    );
    expect(policy).toEqual({ coolant: 'modal', preselect: true });
  });

  it('registers typed lifecycle handlers through definePost', () => {
    const program = new Program();
    const context = createPostContext(() => ({ seen: 0 }));
    const post = definePost(program, context);
    post.on('EndOfFile', () => {
      context.state.seen++;
    });
    expect(program.registeredEvents()).toEqual(['EndOfFile']);
  });

  it('declares and checks driver capabilities', () => {
    const builder = new Builder();
    const driver = defineDriver({
      id: 'capable',
      capabilities: ['cycle.custom'],
      create: () => ({}),
    });
    builder.driver(driver);
    expect(builder.driverSupports('capable', 'cycle.custom')).toBe(true);
    expect(() =>
      builder.requireDriverCapability('capable', 'cycle.missing'),
    ).toThrow(/does not support/);
  });

  it('records explainable emissions', () => {
    const builder = new Builder();
    builder.put('G0 X10', { reason: 'safe positioning' });
    expect(builder.explain()).toContain('safe positioning');
    expect(builder.diagnostics()[0].command).toBe('G0 X10');
  });

  it('offers a concise post expectation DSL', () => {
    expectPost([{ _eventName: 'EndOfFile', _index: 0 }])
      .using((program) => {
        program.on('EndOfFile', ($) => $.ProgramEndAndRewind());
      })
      .toEmit('M30')
      .notToEmit('M2');
  });

  it('reports unsafe post patterns', () => {
    const issues = lintPostSource(`
program.on('Line', () => $.put('CYCLE81(1,2,3)'));
program.on('Line', () => {});
    `);
    expect(issues.map((issue) => issue.rule)).toEqual(
      expect.arrayContaining([
        'no-raw-put',
        'no-controller-command-outside-driver',
        'no-duplicate-handler',
      ]),
    );
  });

  it('reports events without handlers', () => {
    const issues = lintUnhandledEvents(
      [
        { _eventName: 'StartOfFile', _index: 0 },
        { _eventName: 'EndOfFile', _index: 1 },
      ],
      ['StartOfFile'],
    );
    expect(issues).toEqual([
      expect.objectContaining({
        rule: 'unhandled-event',
        message: expect.stringContaining('EndOfFile'),
      }),
    ]);
  });

  it('generates VMID trace extension interfaces', () => {
    const vmid = parseVmid(`
<Machine Name="Demo">
<Param GppName="iMode">
<ParamJobs GppName="sMessage">
    `);
    const types = generateVmidTraceTypes(vmid, {
      interfaceName: 'DemoExtensions',
    });
    expect(types).toContain('interface DemoExtensions');
    expect(types).toContain('iMode?: number');
    expect(types).toContain('sMessage?: string');
    expect(types).toContain(
      "type DemoExtensionsJob = EventsType['StartOfJob']",
    );
  });
});
