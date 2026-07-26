import path from 'node:path';
import {
  type AcharInput,
  bootstrapAchar,
  generateAcharFiles,
  Logger,
  readGeneratedFile,
  resolveWorkspaceRoot,
  validateAcharInput,
} from '@achar/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { constrainAcharInput, resolveInsideWorkspace } from './workspace-paths';

export interface AcharMcpServerOptions {
  workspaceRoot?: string;
  logs?: boolean;
}

const optionalPath = z.string().trim().min(1).optional();
// `satisfies` ties this schema to core's AcharInput: adding or changing a
// field in core without updating the schema fails typecheck instead of
// silently dropping the field from the MCP surface.
const acharInputSchema = z.object({
  tracePath: z.string().trim().min(1).describe('Path to the Trace 5 MPF file.'),
  vmidPath: optionalPath.describe('Optional VMID path.'),
  machineProfilePath: optionalPath.describe(
    'Optional machine profile JSON path.',
  ),
  referencePath: optionalPath.describe('Optional reference output directory.'),
  outputPath: optionalPath.describe('Optional directory for generated files.'),
  programName: z.string().trim().min(1).describe('Generated program name.'),
  postId: z.string().trim().min(1).default('siemens-828d'),
}) satisfies z.ZodType<AcharInput, AcharInput | { postId?: string }>;

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function text(value: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    return toolError(error);
  }
}

function createServer(workspaceRoot: string): McpServer {
  const server = new McpServer({
    name: 'achar',
    version: packageJson.version,
  });

  server.registerTool(
    'achar_workspace',
    {
      title: 'Achar workspace',
      description:
        'List available fixtures, built-in posts, and workspace paths.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => guarded(async () => text(await bootstrapAchar(workspaceRoot))),
  );

  server.registerTool(
    'achar_validate',
    {
      title: 'Validate Achar inputs',
      description:
        'Parse a Trace 5 file and validate it against optional VMID and machine profile inputs.',
      inputSchema: acharInputSchema,
      annotations: { readOnlyHint: true },
    },
    (input) =>
      guarded(async () =>
        text(
          await validateAcharInput(constrainAcharInput(workspaceRoot, input)),
        ),
      ),
  );

  server.registerTool(
    'achar_generate',
    {
      title: 'Generate G-code',
      description:
        'Generate G-code files from Trace 5, optional VMID, and optional machine profile data. Output stays inside the workspace root.',
      inputSchema: acharInputSchema,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (input) =>
      guarded(async () => {
        const constrained = constrainAcharInput(workspaceRoot, input);
        return text(await generateAcharFiles(constrained, workspaceRoot));
      }),
  );

  server.registerTool(
    'achar_read_generated_file',
    {
      title: 'Read generated file',
      description:
        'Read a generated file preview from an Achar output directory inside the workspace root.',
      inputSchema: z.object({
        outputPath: z.string().trim().min(1),
        file: z.string().trim().min(1),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ outputPath, file }) =>
      guarded(async () => {
        const resolvedOutput = resolveInsideWorkspace(
          workspaceRoot,
          outputPath,
          'outputPath',
        );
        resolveInsideWorkspace(resolvedOutput, file, 'file');
        return text(await readGeneratedFile(resolvedOutput, file));
      }),
  );

  return server;
}

export async function startAcharMcpServer(
  options: AcharMcpServerOptions = {},
): Promise<void> {
  if (options.logs !== true && Bun.env.ACHAR_MCP_LOGS !== '1') {
    Logger.setGlobalOptions({ enabled: false });
  }

  const workspaceRoot = options.workspaceRoot
    ? path.resolve(options.workspaceRoot)
    : resolveWorkspaceRoot();
  const server = createServer(workspaceRoot);
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  await startAcharMcpServer();
}
