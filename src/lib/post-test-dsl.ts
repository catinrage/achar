import type { EventsType } from '../types';
import type { EventData } from './parser';
import type { RegisterPost } from './post-loader';
import { type GeneratedFile, generatePostFiles } from './post-test';

export class PostExpectation {
  private files: GeneratedFile[] = [];

  public constructor(
    private readonly events: EventData<keyof EventsType>[],
    private readonly programName = 'Test',
  ) {}

  public using(registerPost: RegisterPost): this {
    this.files = generatePostFiles(this.events, this.programName, registerPost);
    return this;
  }

  public file(name: string): string {
    const file = this.files.find((candidate) => candidate.file === name);
    if (!file) throw new Error(`Generated file not found: ${name}`);
    return file.code;
  }

  public toEmit(...blocks: string[]): this {
    const output = this.files.map((file) => file.code).join('\n');
    for (const block of blocks) {
      if (!output.includes(block)) {
        throw new Error(`Expected generated output to contain: ${block}`);
      }
    }
    return this;
  }

  public toEmitInOrder(...blocks: string[]): this {
    const output = this.files.map((file) => file.code).join('\n');
    let cursor = 0;
    for (const block of blocks) {
      const index = output.indexOf(block, cursor);
      if (index < 0) {
        throw new Error(`Expected generated output in order: ${block}`);
      }
      cursor = index + block.length;
    }
    return this;
  }

  public notToEmit(block: string): this {
    const output = this.files.map((file) => file.code).join('\n');
    if (output.includes(block)) {
      throw new Error(`Expected generated output not to contain: ${block}`);
    }
    return this;
  }
}

export function expectPost(
  events: EventData<keyof EventsType>[],
  options: { programName?: string } = {},
): PostExpectation {
  return new PostExpectation(events, options.programName);
}
