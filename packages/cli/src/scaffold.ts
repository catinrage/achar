import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dropUndefined } from './inputs';
import type { CliOptions } from './options';

export async function initPost(
  directory: string,
  options: CliOptions,
): Promise<void> {
  const root = path.resolve(directory);
  const id = path.basename(root);
  const name = options.name ?? id;

  await mkdir(root, { recursive: true });
  await writeScaffoldFile(
    path.join(root, 'index.ts'),
    postTemplate(name),
    options,
  );
  await writeScaffoldFile(
    path.join(root, 'driver.ts'),
    postDriverTemplate(id),
    options,
  );
  await writeScaffoldFile(
    path.join(root, 'policy.ts'),
    postPolicyTemplate(name),
    options,
  );
  await writeScaffoldFile(
    path.join(root, 'README.md'),
    postReadmeTemplate(name),
    options,
  );

  if (options.fixture) {
    await writeScaffoldFile(
      path.join(root, 'achar.fixture.json'),
      fixtureTemplate(root, options),
      options,
    );
  }
}

async function writeScaffoldFile(
  filePath: string,
  content: string,
  options: CliOptions,
): Promise<void> {
  if (existsSync(filePath) && options.force !== true) {
    throw new Error(
      `Refusing to overwrite ${filePath}; pass --force to replace it.`,
    );
  }

  await writeFile(filePath, content);
}

function postTemplate(_name: string): string {
  return `import { createPostContext, definePost, type Program } from 'achar';
import { controllerDriver } from './driver';
import { postPolicy } from './policy';

export function registerPost(program: Program): void {
  const context = createPostContext(() => ({ jobs: 0 }));
  const post = definePost(program, context);

  post.on('StartOfFile', ($, params) => {
    $.Comment(postPolicy.title);
    $.Comment(\`Part Name: \${params.part_name}\`);
  });

  post.on('StartOfJob', () => {
    context.state.jobs++;
  });

  post.on('EndOfFile', ($) => {
    $.driver(controllerDriver).ProgramEnd();
  });
}

export default registerPost;
`;
}

function postDriverTemplate(id: string): string {
  return `import { defineDriver, type Builder } from 'achar';

export const controllerDriver = defineDriver({
  id: '${escapeTemplateValue(id)}',
  capabilities: ['program.end'],
  create(builder: Builder) {
    return {
      ProgramEnd() {
        builder.ProgramEndAndRewind({ reason: 'controller program end' });
      },
    };
  },
});
`;
}

function postPolicyTemplate(name: string): string {
  return `import { definePostPolicy } from 'achar';

export const postPolicy = definePostPolicy({
  title: '${escapeTemplateValue(name)}',
});
`;
}

function postReadmeTemplate(name: string): string {
  return `# ${name}

Run this post against a fixture:

\`\`\`bash
achar test . --post ./index.ts
\`\`\`
`;
}

function fixtureTemplate(root: string, options: CliOptions): string {
  const manifest = {
    trace: relativeFixturePath(root, options.trace ?? 'trace.MPF'),
    reference: relativeFixturePath(root, options.reference ?? 'reference'),
    programName: options.programName,
    post: './index.ts',
    vmid: options.vmid ? relativeFixturePath(root, options.vmid) : undefined,
    machineProfile: options.machineProfile
      ? relativeFixturePath(root, options.machineProfile)
      : undefined,
  };

  return `${JSON.stringify(dropUndefined(manifest), null, 2)}\n`;
}

function relativeFixturePath(root: string, filePath: string): string {
  return path.relative(root, path.resolve(filePath)).replaceAll('\\', '/');
}

function escapeTemplateValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}
