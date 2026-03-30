import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { loadTestEnv, createUniqueUser } from './test-utils';
import { createApp } from '../src/lib/db';
import { createDirectory } from '../src/lib/sandbox-fs';
import { runWithToolContext } from '../src/lib/ai/tools/context';
import {
  executeReadFile,
  executeWriteFile,
  executePatchFile,
  executeListFiles,
  executeSearchFiles,
} from '../src/lib/ai/tools/coding-tools';

loadTestEnv();

// Helper: run a coding tool with proper app context
function runCodingTool<T>(
  userId: string,
  appId: string,
  executor: (args: any) => Promise<T>,
  args: any
): Promise<T> {
  return runWithToolContext(
    { userId, appContext: { appId, appSecrets: {} } },
    () => executor(args)
  );
}

test.describe('Coding Tools Integration', () => {
  test.describe.configure({ mode: 'serial' });

  let userId: string;
  let appId: string;

  test.beforeAll(async () => {
    const user = await createUniqueUser();
    userId = user.id;
    appId = uuidv4();
    await createApp(userId, appId, 'CodingToolsTestApp');
    await createDirectory(`apps/${appId}`);
    await createDirectory('app');
  });

  // ---- write_file ----

  test.describe('write_file', () => {
    test('creates a new file', async () => {
      const result = await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/hello.txt',
        content: 'Hello World\n',
      });
      expect(result.bytes_written).toBe(12);
      expect(result.path).toBe('app/hello.txt');
    });

    test('creates a file with nested directories', async () => {
      const result = await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/src/lib/utils.js',
        content: 'export function add(a, b) { return a + b; }\n',
      });
      expect(result.bytes_written).toBeGreaterThan(0);
    });

    test('overwrites an existing file', async () => {
      await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/overwrite.txt',
        content: 'original',
      });
      const result = await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/overwrite.txt',
        content: 'replaced',
      });
      expect(result.bytes_written).toBe(8);

      // Verify content was replaced
      const read = await runCodingTool(userId, appId, executeReadFile, { path: 'app/overwrite.txt' });
      expect(read.content).toContain('replaced');
      expect(read.content).not.toContain('original');
    });

    test('writes an empty file', async () => {
      const result = await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/empty.txt',
        content: '',
      });
      expect(result.bytes_written).toBe(0);
    });
  });

  // ---- read_file ----

  test.describe('read_file', () => {
    test.beforeAll(async () => {
      // Set up a multi-line file for read tests
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: content here`).join('\n') + '\n';
      await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/multiline.txt',
        content: lines,
      });
    });

    test('reads an entire file', async () => {
      const result = await runCodingTool(userId, appId, executeReadFile, { path: 'app/hello.txt' });
      expect(result.content).toContain('Hello World');
      expect(result.total_lines).toBe(1);
    });

    test('reads a specific line range', async () => {
      const result = await runCodingTool(userId, appId, executeReadFile, {
        path: 'app/multiline.txt',
        start_line: 5,
        end_line: 10,
      });
      expect(result.content).toContain('Line 5');
      expect(result.content).toContain('Line 10');
      expect(result.content).not.toContain('Line 4:');
      expect(result.content).not.toContain('Line 11:');
      expect(result.range).toBe('5-10');
    });

    test('reads from start_line to end of file', async () => {
      const result = await runCodingTool(userId, appId, executeReadFile, {
        path: 'app/multiline.txt',
        start_line: 18,
      });
      expect(result.content).toContain('Line 18');
      expect(result.content).toContain('Line 20');
      expect(result.total_lines).toBe(3);
    });

    test('returns error for non-existent file', async () => {
      const result = await runCodingTool(userId, appId, executeReadFile, { path: 'app/nonexistent.txt' });
      expect(result.error).toContain('File not found');
    });

    test('rejects path traversal', async () => {
      await expect(
        runCodingTool(userId, appId, executeReadFile, { path: '../../../etc/passwd' })
      ).rejects.toThrow('Path traversal');
    });
  });

  // ---- patch_file ----

  test.describe('patch_file', () => {
    test.beforeAll(async () => {
      await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/patch-target.js',
        content: `function greet(name) {\n  console.log("Hello, " + name);\n}\n\ngreet("World");\n`,
      });
    });

    test('replaces unique text in a file', async () => {
      const result = await runCodingTool(userId, appId, executePatchFile, {
        path: 'app/patch-target.js',
        old_text: 'console.log("Hello, " + name)',
        new_text: 'console.log(`Hello, ${name}!`)',
      });
      expect(result.status).toBe('patched');

      const read = await runCodingTool(userId, appId, executeReadFile, { path: 'app/patch-target.js' });
      expect(read.content).toContain('`Hello, ${name}!`');
      expect(read.content).not.toContain('"Hello, " + name');
    });

    test('returns error if old_text not found', async () => {
      const result = await runCodingTool(userId, appId, executePatchFile, {
        path: 'app/patch-target.js',
        old_text: 'this text does not exist',
        new_text: 'replacement',
      });
      expect(result.error).toContain('old_text not found');
    });

    test('returns error if old_text appears multiple times', async () => {
      // Create a file with repeated text
      await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/dupes.txt',
        content: 'foo\nbar\nfoo\n',
      });
      const result = await runCodingTool(userId, appId, executePatchFile, {
        path: 'app/dupes.txt',
        old_text: 'foo',
        new_text: 'baz',
      });
      expect(result.error).toContain('multiple times');
    });

    test('returns error for non-existent file', async () => {
      const result = await runCodingTool(userId, appId, executePatchFile, {
        path: 'app/no-such-file.txt',
        old_text: 'a',
        new_text: 'b',
      });
      expect(result.error).toContain('File not found');
    });

    test('returns error for empty old_text', async () => {
      const result = await runCodingTool(userId, appId, executePatchFile, {
        path: 'app/patch-target.js',
        old_text: '',
        new_text: 'something',
      });
      expect(result.error).toContain('empty');
    });
  });

  // ---- list_files ----

  test.describe('list_files', () => {
    test('lists files in app directory', async () => {
      const result = await runCodingTool(userId, appId, executeListFiles, { path: 'app' });
      expect(result.count).toBeGreaterThan(0);
      const names = result.files.map((f: any) => typeof f === 'string' ? f : f.name);
      expect(names).toContain('hello.txt');
    });

    test('lists files with glob pattern', async () => {
      const result = await runCodingTool(userId, appId, executeListFiles, {
        path: 'app',
        pattern: '*.txt',
        recursive: true,
      });
      expect(result.count).toBeGreaterThan(0);
      const files = result.files as string[];
      expect(files.every((f: string) => f.endsWith('.txt'))).toBeTruthy();
    });

    test('lists files in subdirectory', async () => {
      const result = await runCodingTool(userId, appId, executeListFiles, { path: 'app/src' });
      expect(result.count).toBeGreaterThan(0);
    });

    test('lists files recursively', async () => {
      const result = await runCodingTool(userId, appId, executeListFiles, {
        path: 'app',
        pattern: '*.js',
        recursive: true,
      });
      expect(result.count).toBeGreaterThan(0);
      const files = result.files as string[];
      expect(files.some((f: string) => f.includes('/'))).toBeTruthy();
    });

    test('returns error for non-existent directory', async () => {
      const result = await runCodingTool(userId, appId, executeListFiles, { path: 'app/nonexistent-dir' });
      expect(result.error).toBeTruthy();
    });
  });

  // ---- search_files ----

  test.describe('search_files', () => {
    test.beforeAll(async () => {
      await runCodingTool(userId, appId, executeWriteFile, {
        path: 'app/search-target.js',
        content: `function hello() {\n  return "hello world";\n}\n\nfunction goodbye() {\n  return "goodbye world";\n}\n`,
      });
    });

    test('searches by regex pattern', async () => {
      const result = await runCodingTool(userId, appId, executeSearchFiles, {
        pattern: 'function.*\\(',
      });
      expect(result.count).toBeGreaterThanOrEqual(2);
      expect(result.matches.some((m: any) => m.text.includes('hello'))).toBeTruthy();
      expect(result.matches.some((m: any) => m.text.includes('goodbye'))).toBeTruthy();
    });

    test('filters by file pattern', async () => {
      const result = await runCodingTool(userId, appId, executeSearchFiles, {
        pattern: 'function',
        file_pattern: '*.js',
      });
      expect(result.count).toBeGreaterThan(0);
      expect(result.matches.every((m: any) => !m.file || m.file.endsWith('.js'))).toBeTruthy();
    });

    test('limits results with max_results', async () => {
      const result = await runCodingTool(userId, appId, executeSearchFiles, {
        pattern: 'world',
        max_results: 1,
      });
      expect(result.count).toBe(1);
    });

    test('returns empty matches when no results found', async () => {
      const result = await runCodingTool(userId, appId, executeSearchFiles, {
        pattern: 'zzz_nonexistent_pattern_zzz',
      });
      expect(result.matches).toEqual([]);
      expect(result.count).toBe(0);
    });

    test('returns matches with file, line, and text', async () => {
      const result = await runCodingTool(userId, appId, executeSearchFiles, {
        pattern: 'hello world',
      });
      expect(result.count).toBeGreaterThan(0);
      const match = result.matches[0];
      expect(match.file).toBeTruthy();
      expect(match.line).toBeGreaterThan(0);
      expect(match.text).toContain('hello world');
    });
  });

  // ---- Security ----

  test.describe('security', () => {
    test('rejects path traversal in all tools', async () => {
      const traversalPath = '../../etc/passwd';

      await expect(
        runCodingTool(userId, appId, executeReadFile, { path: traversalPath })
      ).rejects.toThrow('Path traversal');

      await expect(
        runCodingTool(userId, appId, executeWriteFile, { path: traversalPath, content: 'hack' })
      ).rejects.toThrow('Path traversal');

      await expect(
        runCodingTool(userId, appId, executePatchFile, { path: traversalPath, old_text: 'a', new_text: 'b' })
      ).rejects.toThrow('Path traversal');
    });

    test('fails without app context', async () => {
      // Run without appContext in the context
      await expect(
        runWithToolContext({ userId }, () => executeReadFile({ path: 'app/hello.txt' }))
      ).rejects.toThrow('only available in app chats');
    });
  });
});
