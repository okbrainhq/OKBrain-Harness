import { spawn } from './spawn';
import path from 'path';

const SANDBOX_HOME = '/home/brain-sandbox';
const MAX_FILE_SIZE = 500 * 1024; // 500KB
const TIMEOUT_MS = 5000;

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function validatePath(relativePath: string): string {
  // Strip leading slash — paths are relative to SANDBOX_HOME
  // e.g. "/" means the home dir, "/foo" means home/foo
  const stripped = relativePath.replace(/^\/+/, '');
  const normalized = stripped ? path.normalize(stripped) : '.';
  if (normalized.startsWith('..')) {
    throw new Error('Invalid path: path traversal not allowed');
  }
  const fullPath = path.join(SANDBOX_HOME, normalized);
  if (!fullPath.startsWith(SANDBOX_HOME)) {
    throw new Error('Invalid path: outside sandbox');
  }
  return fullPath;
}

/** Resolve symlinks and verify the real path is still inside the sandbox. */
async function validatePathResolved(relativePath: string): Promise<string> {
  const fullPath = validatePath(relativePath);

  // Use readlink -f to resolve all symlinks to the final target
  const result = await execAsSandboxUser(['readlink', '-f', fullPath]);
  if (result.exitCode === 0) {
    const resolved = result.stdout.trim();
    if (resolved && !resolved.startsWith(SANDBOX_HOME)) {
      throw new Error('Invalid path: symlink points outside sandbox');
    }
    // Return resolved path to prevent TOCTOU symlink swap attacks
    if (resolved) return resolved;
  }
  // If readlink fails (file doesn't exist yet), basic validation is sufficient

  return fullPath;
}

function execAsSandboxUser(args: string[], stdin?: string | Buffer, timeoutMs?: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sudo', [
      'systemd-run',
      '--wait',
      '--pipe',
      '--quiet',
      '--uid=brain-sandbox',
      '--gid=brain-sandbox',
      '--property=NoNewPrivileges=yes',
      '--property=ProtectSystem=strict',
      '--property=ProtectHome=tmpfs',
      `--property=BindPaths=${SANDBOX_HOME}`,
      `--property=ReadWritePaths=${SANDBOX_HOME}`,
      '--property=PrivateTmp=yes',
      '--property=SystemCallFilter=~mount pivot_root open_by_handle_at bpf perf_event_open',
      '--property=SystemCallErrorNumber=EPERM',
      `--working-directory=${SANDBOX_HOME}`,
      '--',
      ...args,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    if (stdin !== undefined) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Operation timed out'));
    }, timeoutMs || TIMEOUT_MS);

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

export async function listDirectory(relativePath: string): Promise<DirectoryEntry[]> {
  const fullPath = await validatePathResolved(relativePath);

  const result = await execAsSandboxUser([
    'ls', '-la', '--time-style=long-iso', fullPath,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to list directory: ${result.stderr.trim()}`);
  }

  const entries: DirectoryEntry[] = [];
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    // Skip empty lines and total line
    if (!line.trim() || line.startsWith('total ')) continue;

    // Parse ls -la output:
    // drwxr-xr-x 2 brain-sandbox brain-sandbox 4096 2024-01-15 10:30 dirname
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;

    const perms = parts[0];
    const size = parseInt(parts[4], 10);
    const dateStr = parts[5]; // 2024-01-15
    const timeStr = parts[6]; // 10:30
    const name = parts.slice(7).join(' ');

    // Skip . and ..
    if (name === '.' || name === '..') continue;

    entries.push({
      name,
      isDirectory: perms.startsWith('d'),
      size: isNaN(size) ? 0 : size,
      modifiedAt: `${dateStr} ${timeStr}`,
    });
  }

  return entries;
}

export async function readFile(relativePath: string): Promise<{ content: string; size: number }> {
  const fullPath = await validatePathResolved(relativePath);

  // Check file size first
  const info = await getFileInfo(relativePath);
  if (!info.exists) {
    throw new Error('File not found');
  }
  if (info.isDir) {
    throw new Error('Cannot read a directory');
  }
  if (info.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${info.size} bytes, max ${MAX_FILE_SIZE})`);
  }

  const result = await execAsSandboxUser(['cat', fullPath]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to read file: ${result.stderr.trim()}`);
  }

  return {
    content: result.stdout,
    size: info.size,
  };
}

export async function writeFile(relativePath: string, content: string): Promise<void> {
  const fullPath = await validatePathResolved(relativePath);

  const result = await execAsSandboxUser(['tee', fullPath], content);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to write file: ${result.stderr.trim()}`);
  }
}

export async function deleteEntry(relativePath: string): Promise<void> {
  const fullPath = await validatePathResolved(relativePath);

  // Prevent deleting the home directory itself
  if (fullPath === SANDBOX_HOME) {
    throw new Error('Cannot delete the home directory');
  }

  const result = await execAsSandboxUser(['rm', '-rf', fullPath]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to delete: ${result.stderr.trim()}`);
  }
}

export async function createDirectory(relativePath: string): Promise<void> {
  const fullPath = await validatePathResolved(relativePath);

  const result = await execAsSandboxUser(['mkdir', '-p', fullPath]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create directory: ${result.stderr.trim()}`);
  }
}

export async function writeFileBinary(relativePath: string, data: Buffer): Promise<void> {
  const fullPath = await validatePathResolved(relativePath);
  // Use dd instead of tee to avoid echoing binary data to stdout
  const result = await execAsSandboxUser(['dd', `of=${fullPath}`, 'status=none'], data, 30000);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write file: ${result.stderr.trim()}`);
  }
}

export async function renameEntry(oldRelativePath: string, newRelativePath: string): Promise<void> {
  const oldFullPath = await validatePathResolved(oldRelativePath);
  const newFullPath = await validatePathResolved(newRelativePath);

  if (oldFullPath === SANDBOX_HOME || newFullPath === SANDBOX_HOME) {
    throw new Error('Cannot rename the home directory');
  }

  const result = await execAsSandboxUser(['mv', oldFullPath, newFullPath]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to rename: ${result.stderr.trim()}`);
  }
}

export async function getFileInfo(relativePath: string): Promise<{ exists: boolean; isDir: boolean; size: number }> {
  const fullPath = await validatePathResolved(relativePath);

  const result = await execAsSandboxUser([
    'stat', '--format=%F %s', fullPath,
  ]);

  if (result.exitCode !== 0) {
    return { exists: false, isDir: false, size: 0 };
  }

  const output = result.stdout.trim();
  const parts = output.split(' ');
  const fileType = parts[0]; // "directory" or "regular"
  const size = parseInt(parts[parts.length - 1], 10);

  return {
    exists: true,
    isDir: fileType === 'directory',
    size: isNaN(size) ? 0 : size,
  };
}
