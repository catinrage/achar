import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  bootstrapAchar,
  generateAcharFiles,
  readGeneratedFile,
  resolveWorkspaceRoot,
  validateAcharInput,
} from '../desktop/backend';
import { Logger } from '../lib/logger';

export interface AcharMcpServerOptions {
  workspaceRoot?: string;
  logs?: boolean;
}

const optionalPath = z.string().trim().min(1).optional();
const desktopInputSchema = z.object({
  tracePath: z.string().trim().min(1).describe('Path to the Trace 5 MPF file.'),
  vmidPath: optionalPath.describe('Optional VMID path.'),
  machineProfilePath: optionalPath.describe(
    'Optional machine profile JSON path.',
  ),
  referencePath: optionalPath.describe('Optional reference output directory.'),
  outputPath: optionalPath.describe('Optional directory for generated files.'),
  programName: z.string().trim().min(1).describe('Generated program name.'),
  postId: z.string().trim().min(1).default('siemens-828d'),
});

function text(value: unknown) {
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

function createServer(workspaceRoot: string): McpServer {
  const server = new McpServer({
    name: 'achar',
    version: '0.1.0',
  });

  server.registerTool(
    'achar_workspace',
    {
      title: 'Achar workspace',
      description:
        'List available fixtures, built-in posts, and workspace paths.',
      inputSchema: z.object({}),
    },
    async () => text(await bootstrapAchar(workspaceRoot)),
  );

  server.registerTool(
    'achar_validate',
    {
      title: 'Validate Achar inputs',
      description:
        'Parse a Trace 5 file and validate it against optional VMID and machine profile inputs.',
      inputSchema: desktopInputSchema,
    },
    async (input) => text(await validateAcharInput(input)),
  );

  server.registerTool(
    'achar_generate',
    {
      title: 'Generate G-code',
      description:
        'Generate G-code files from Trace 5, optional VMID, and optional machine profile data.',
      inputSchema: desktopInputSchema,
    },
    async (input) => text(await generateAcharFiles(input, workspaceRoot)),
  );

  server.registerTool(
    'achar_read_generated_file',
    {
      title: 'Read generated file',
      description:
        'Read a generated file preview from an Achar output directory.',
      inputSchema: z.object({
        outputPath: z.string().trim().min(1),
        file: z.string().trim().min(1),
      }),
    },
    async ({ outputPath, file }) =>
      text(await readGeneratedFile(outputPath, file)),
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
    ? options.workspaceRoot
    : resolveWorkspaceRoot();
  const server = createServer(workspaceRoot);
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  await startAcharMcpServer();
}
