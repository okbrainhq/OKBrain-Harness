import { Tool, ToolDefinition } from './types';
import { getToolContext, getUserIdFromContext } from './context';
import { spawn } from '../../spawn';
import { createDirectory } from '../../sandbox-fs';

const SANDBOX_HOME = '/home/brain-sandbox';
const EXEC_TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 10000;

// ---- Utility ----

interface AppContext {
  appId: string;
  appSecrets: Record<string, string>;
}

function requireAppContext(): AppContext {
  const ctx = getToolContext();
  const appContext = ctx?.appContext as AppContext | undefined;
  if (!appContext?.appId) {
    throw new Error('This tool is only available in app chats.');
  }
  return appContext;
}

function safePath(inputPath: string): string {
  const trimmed = (inputPath || '').trim().replace(/^\/+/, '');
  if (!trimmed) return '.';
  const parts = trimmed.split('/').filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') throw new Error('Path traversal ("..") is not allowed.');
    if (part !== '.') resolved.push(part);
  }
  return resolved.length > 0 ? resolved.join('/') : '.';
}

async function ensureAppDirs(appId: string): Promise<void> {
  try {
    await createDirectory(`apps/${appId}`);
    await createDirectory('app');
  } catch (_) {
    // Non-fatal — directories may already exist
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

async function execInApp(
  appId: string,
  args: string[],
  options?: { stdin?: string; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const appDir = `${SANDBOX_HOME}/apps/${appId}`;
  // Always block the apps dir — the bind-mount to ~/app handles per-app access.
  const inaccessible = ['/var/www', '/root', '/home/brain-sandbox/apps'];

  // Inject OKBRAIN_USERID if available
  const envFlags: string[] = [];
  const userId = getUserIdFromContext();
  if (userId) {
    envFlags.push(`--setenv=OKBRAIN_USERID=${userId}`);
  }

  const cmdArgs = [
    'systemd-run',
    '--wait', '--pipe', '--quiet',
    '--uid=brain-sandbox', '--gid=brain-sandbox',
    '--property=NoNewPrivileges=yes',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=tmpfs',
    `--property=BindPaths=${SANDBOX_HOME}`,
    `--property=ReadWritePaths=${SANDBOX_HOME}`,
    `--property=BindPaths=${appDir}:${SANDBOX_HOME}/app`,
    `--property=ReadWritePaths=${SANDBOX_HOME}/app`,
    '--property=PrivateTmp=yes',
    '--property=SystemCallFilter=~mount pivot_root open_by_handle_at bpf perf_event_open',
    '--property=SystemCallErrorNumber=EPERM',
    ...(inaccessible.length > 0
      ? [`--property=InaccessiblePaths=${inaccessible.join(' ')}`]
      : []),
    ...envFlags,
    `--working-directory=${SANDBOX_HOME}`,
    '--',
    ...args,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('sudo', cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    if (options?.stdin !== undefined) {
      proc.stdin.write(options.stdin);
    }
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Operation timed out'));
    }, options?.timeoutMs || EXEC_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---- 1. read_file ----

const readFileDefinition: ToolDefinition = {
  name: 'read_file',
  description: `Read file contents with line numbers. Use start_line/end_line for large files.`,
  shortDescription: 'Read a file or line range from the project.',
  parameters: {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'File path relative to home directory (e.g. "app/src/index.js")',
      },
      start_line: {
        type: 'INTEGER',
        description: 'First line to read (1-indexed). Omit to start from the beginning.',
      },
      end_line: {
        type: 'INTEGER',
        description: 'Last line to read (inclusive). Omit to read to the end.',
      },
    },
    required: ['path'],
  },
};

export async function executeReadFile(args: {
  path: string;
  start_line?: number;
  end_line?: number;
}): Promise<any> {
  const { appId } = requireAppContext();
  const filePath = safePath(args.path);
  await ensureAppDirs(appId);

  let command: string[];
  if (args.start_line || args.end_line) {
    const start = Math.max(1, args.start_line ?? 1);
    const end = args.end_line ? String(args.end_line) : '$';
    command = ['bash', '-c', `sed -n '${start},${end}p' ${shellEscape(filePath)} | cat -n | sed 's/^ *\\([0-9]*\\)\\t/\\1\\t/' | awk -v offset=${start - 1} '{$1=$1+offset; print}'`];
  } else {
    command = ['cat', '-n', filePath];
  }

  const result = await execInApp(appId, command);

  if (result.exitCode !== 0) {
    const err = result.stderr.trim();
    if (err.includes('No such file')) return { error: `File not found: ${args.path}` };
    if (err.includes('Is a directory')) return { error: 'Cannot read a directory. Use list_files instead.' };
    return { error: err || `Failed to read file (exit code ${result.exitCode})` };
  }

  const lines = result.stdout.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  return {
    content: result.stdout,
    total_lines: lines.length,
    ...(args.start_line || args.end_line
      ? { range: `${args.start_line ?? 1}-${args.end_line ?? 'end'}` }
      : {}),
  };
}

// ---- 2. write_file ----

const writeFileDefinition: ToolDefinition = {
  name: 'write_file',
  description: 'Create or overwrite a file. Parent directories are created automatically.',
  shortDescription: 'Create or overwrite a file.',
  parameters: {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'File path relative to home directory',
      },
      content: {
        type: 'STRING',
        description: 'Complete file content to write',
      },
    },
    required: ['path', 'content'],
  },
};

export async function executeWriteFile(args: {
  path: string;
  content: string;
}): Promise<any> {
  const { appId } = requireAppContext();
  const filePath = safePath(args.path);
  await ensureAppDirs(appId);

  // Create parent directories if needed
  const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : null;
  if (dir) {
    await execInApp(appId, ['mkdir', '-p', dir]);
  }

  const result = await execInApp(appId, ['tee', filePath], { stdin: args.content });

  if (result.exitCode !== 0) {
    return { error: result.stderr.trim() || `Failed to write file (exit code ${result.exitCode})` };
  }

  return {
    path: args.path,
    bytes_written: Buffer.byteLength(args.content, 'utf8'),
  };
}

// ---- 3. patch_file ----

const patchFileDefinition: ToolDefinition = {
  name: 'patch_file',
  description: `Edit a file by finding and replacing text. The old_text must match exactly (including whitespace/indentation) and appear exactly once. Use read_file first to see current content.`,
  shortDescription: 'Edit a file by finding and replacing text.',
  parameters: {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'File path relative to home directory',
      },
      old_text: {
        type: 'STRING',
        description: 'Exact text to find (must appear exactly once)',
      },
      new_text: {
        type: 'STRING',
        description: 'Replacement text',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },
};

export async function executePatchFile(args: {
  path: string;
  old_text: string;
  new_text: string;
}): Promise<any> {
  const { appId } = requireAppContext();
  const filePath = safePath(args.path);
  await ensureAppDirs(appId);

  if (!args.old_text) {
    return { error: 'old_text cannot be empty.' };
  }

  // Read current content
  const readResult = await execInApp(appId, ['cat', filePath]);
  if (readResult.exitCode !== 0) {
    const err = readResult.stderr.trim();
    if (err.includes('No such file')) return { error: `File not found: ${args.path}` };
    return { error: err || 'Failed to read file' };
  }

  const content = readResult.stdout;

  // Check old_text exists and is unique
  const firstIdx = content.indexOf(args.old_text);
  if (firstIdx === -1) {
    return { error: 'old_text not found in the file. Make sure it matches exactly, including whitespace and indentation. Use read_file to check the current content.' };
  }
  const secondIdx = content.indexOf(args.old_text, firstIdx + 1);
  if (secondIdx !== -1) {
    return { error: 'old_text appears multiple times in the file. Provide more surrounding context to make it unique.' };
  }

  // Apply replacement
  const newContent = content.substring(0, firstIdx) + args.new_text + content.substring(firstIdx + args.old_text.length);

  // Write back
  const writeResult = await execInApp(appId, ['tee', filePath], { stdin: newContent });
  if (writeResult.exitCode !== 0) {
    return { error: writeResult.stderr.trim() || 'Failed to write patched file' };
  }

  return {
    path: args.path,
    status: 'patched',
  };
}

// ---- 4. list_files ----

const listFilesDefinition: ToolDefinition = {
  name: 'list_files',
  description: 'List files and directories. Use pattern to filter by glob. Use recursive to search subdirectories.',
  shortDescription: 'List files in a directory.',
  parameters: {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'Directory relative to home directory (default: ".")',
      },
      pattern: {
        type: 'STRING',
        description: 'Glob pattern to filter (e.g. "*.js", "*.ts")',
      },
      recursive: {
        type: 'BOOLEAN',
        description: 'Search subdirectories (default: false)',
      },
    },
  },
};

export async function executeListFiles(args: {
  path?: string;
  pattern?: string;
  recursive?: boolean;
}): Promise<any> {
  const { appId } = requireAppContext();
  const dirPath = safePath(args.path || '.');
  await ensureAppDirs(appId);

  let command: string[];
  if (args.recursive || args.pattern) {
    const parts = ['find', shellEscape(dirPath)];
    if (!args.recursive) parts.push('-maxdepth', '1');
    parts.push('-not', '-path', shellEscape('*/node_modules/*'));
    parts.push('-not', '-path', shellEscape('*/.git/*'));
    if (args.pattern) parts.push('-name', shellEscape(args.pattern));
    parts.push('|', 'sort', '|', 'head', '-500');
    command = ['bash', '-c', parts.join(' ')];
  } else {
    command = ['ls', '-la', '--time-style=long-iso', dirPath];
  }

  const result = await execInApp(appId, command, { timeoutMs: EXEC_TIMEOUT_MS });

  if (result.exitCode !== 0) {
    const err = result.stderr.trim();
    if (err.includes('No such file')) return { error: `Directory not found: ${args.path || '.'}` };
    return { error: err || 'Failed to list files' };
  }

  if (args.recursive || args.pattern) {
    const files = result.stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
    return { files, count: files.length };
  }

  // Parse ls -la output
  const entries: Array<{ name: string; type: string; size: number }> = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim() || line.startsWith('total ')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const perms = parts[0];
    const size = parseInt(parts[4], 10);
    const name = parts.slice(7).join(' ');
    if (name === '.' || name === '..') continue;
    entries.push({
      name,
      type: perms.startsWith('d') ? 'directory' : 'file',
      size: isNaN(size) ? 0 : size,
    });
  }
  return { files: entries, count: entries.length };
}

// ---- 5. search_files ----

const searchFilesDefinition: ToolDefinition = {
  name: 'search_files',
  description: 'Search file contents using regex. Returns matching lines with file paths and line numbers.',
  shortDescription: 'Search file contents by regex.',
  parameters: {
    type: 'OBJECT',
    properties: {
      pattern: {
        type: 'STRING',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'STRING',
        description: 'Directory to search in, must be inside app/ (default: "app")',
      },
      file_pattern: {
        type: 'STRING',
        description: 'Glob to filter files (e.g. "*.js", "*.py")',
      },
      max_results: {
        type: 'INTEGER',
        description: 'Maximum matching lines to return (default: 50, max: 200)',
      },
    },
    required: ['pattern'],
  },
};

export async function executeSearchFiles(args: {
  pattern: string;
  path?: string;
  file_pattern?: string;
  max_results?: number;
}): Promise<any> {
  const { appId } = requireAppContext();
  const maxResults = Math.min(Math.max(args.max_results || 50, 1), 200);
  await ensureAppDirs(appId);

  // Only allow searching inside ~/app
  let searchPath = 'app';
  if (args.path) {
    const safe = safePath(args.path);
    if (safe === '.' || safe.startsWith('app')) {
      searchPath = safe === '.' ? 'app' : safe;
    } else {
      return { error: 'Search is restricted to the app directory. Use path "app/..." or omit it.' };
    }
  }

  const parts = ['grep', '-rn', '-I', '-E', '--color=never'];
  if (args.file_pattern) parts.push('--include=' + shellEscape(args.file_pattern));
  parts.push('--exclude-dir=node_modules', '--exclude-dir=.git');
  parts.push('--', shellEscape(args.pattern), shellEscape(searchPath));
  parts.push('2>/dev/null', '|', 'head', `-${maxResults}`);

  const result = await execInApp(appId, ['bash', '-c', parts.join(' ')], { timeoutMs: SEARCH_TIMEOUT_MS });

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    return { error: result.stderr.trim() || 'Search failed' };
  }

  if (!result.stdout.trim()) {
    return { matches: [], count: 0 };
  }

  const lines = result.stdout.trim().split('\n');
  const matches = lines.map(line => {
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (m) return { file: m[1].replace(/^\.\//, ''), line: parseInt(m[2], 10), text: m[3] };
    return { text: line };
  });

  return { matches, count: matches.length };
}

// ---- Export ----

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  return s.length > max ? s.substring(0, max) + '\n[truncated]' : s;
}

export const codingTools: Tool[] = [
  {
    definition: readFileDefinition,
    execute: executeReadFile,
    getCallEventExtra: (args) => ({ file_path: args?.path }),
    getResultEventExtra: (result) => result?.error
      ? { error: result.error }
      : { content: truncate(result?.content, 10000), total_lines: result?.total_lines, range: result?.range },
  },
  {
    definition: writeFileDefinition,
    execute: executeWriteFile,
    getCallEventExtra: (args) => ({ file_path: args?.path }),
    getResultEventExtra: (result) => result?.error
      ? { error: result.error }
      : { path: result?.path, bytes_written: result?.bytes_written },
  },
  {
    definition: patchFileDefinition,
    execute: executePatchFile,
    getCallEventExtra: (args) => ({ file_path: args?.path }),
    getResultEventExtra: (result) => result?.error
      ? { error: result.error }
      : { path: result?.path, patch_status: result?.status },
  },
  {
    definition: listFilesDefinition,
    execute: executeListFiles,
    getResultEventExtra: (result) => result?.error
      ? { error: result.error }
      : { count: result?.count, files: result?.files?.slice(0, 100) },
  },
  {
    definition: searchFilesDefinition,
    execute: executeSearchFiles,
    getCallEventExtra: (args) => ({ search_pattern: args?.pattern }),
    getResultEventExtra: (result) => result?.error
      ? { error: result.error }
      : { count: result?.count, matches: result?.matches?.slice(0, 50) },
  },
];

export const CODING_TOOL_NAMES = codingTools.map(t => t.definition.name);
