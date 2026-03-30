#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Global state for signal handling
let currentProc = null;

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('\nReceived SIGINT. Cleaning up...', colors.yellow);
  if (currentProc) {
    currentProc.kill();
  }
  process.exit(130);
});

/**
 * Runs a command silently and captures output.
 * Uses JSON reporter for parsing if specified.
 */
async function runSilentCommand(command, args, env = {}, timeoutMs = 300000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const startTime = Date.now();

    const proc = spawn(command, args, {
      env: { ...process.env, ...env, FORCE_COLOR: '0', NODE_ENV: 'test' },
    });

    currentProc = proc;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      if (currentProc === proc) {
        log(`\nCommand timed out after ${timeoutMs}ms`, colors.red);
        proc.kill();
      }
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      if (currentProc === proc) currentProc = null;
      resolve({ code, stdout, stderr, duration });
    });
  });
}

/**
 * Runs a command and only shows output if it fails.
 */
async function runCommandWithConditionalOutput(command, args, env = {}) {
  const result = await runSilentCommand(command, args, env);
  if (result.code !== 0) {
    const combined = result.stdout + result.stderr;
    const lines = combined.split('\n');
    const lastLines = lines.slice(-200);

    process.stdout.write(`\n${colors.gray}--- [DEBUG] Last 200 lines of failure output ---${colors.reset}\n`);
    process.stdout.write(lastLines.join('\n'));
    process.stdout.write(`\n${colors.gray}--- [DEBUG] End of failure output ---${colors.reset}\n\n`);
  }
  return result;
}

/**
 * Parses Playwright JSON output to find failures.
 */
function parsePlaywrightJSON(output) {
  const failures = [];
  try {
    // Playwright JSON output might be surrounded by other logs.
    // We look for the JSON blob which starts with { and contains "suites"
    // However, simplified approach: try to find the last valid JSON object line or block.
    // Standard reporter=json outputs one big object.

    // Find valid JSON start/end
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1) {
      return []; // No JSON found
    }

    const potentialJson = output.substring(jsonStart, jsonEnd + 1);
    const data = JSON.parse(potentialJson);

    if (!data.suites) return [];

    function traverseSuite(suite) {
      if (suite.specs) {
        suite.specs.forEach(spec => {
          if (!spec.ok && spec.tests) {
            spec.tests.forEach(test => {
              if (test.status === 'unexpected' || test.status === 'flaky') {
                failures.push({
                  file: spec.file,
                  testName: spec.title,
                  project: test.projectName
                });
              }
            });
          }
        });
      }
      if (suite.suites) {
        suite.suites.forEach(traverseSuite);
      }
    }

    data.suites.forEach(traverseSuite);

  } catch (e) {
    // console.error('Error parsing JSON:', e);
    // Fallback or just return empty if parsing failed (likely really bad crash)
  }
  return failures;
}

/**
 * Fallback parser for text output (used in retry phase if needed, or if JSON fails)
 */
function parsePlaywrightText(output) {
  const failures = [];
  const lines = output.split('\n');
  const testPattern = /\[([^\]]+)\]\s*›\s*([^:]+):(\d+):(\d+)\s*›\s*(.*)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(testPattern);
    if (match) {
      const [, project, file, , , testName] = match;
      if (!failures.some(f => f.testName === testName.trim() && f.file === file.trim())) {
        failures.push({ project, file: file.trim(), testName: testName.trim() });
      }
    }
  }
  return failures;
}

async function countTestsInSpec(specFile) {
  return new Promise((resolve) => {
    let stdout = '';
    const proc = spawn('npx', ['playwright', 'test', specFile, '--list'], {
      env: { ...process.env, FORCE_COLOR: '0', NODE_ENV: 'test' },
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      const testLines = stdout.split('\n').filter(line => line.includes('›'));
      resolve(testLines.length);
    });
  });
}

function formatDuration(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

async function main() {
  const args = process.argv.slice(2);
  const e2eDir = path.join(process.cwd(), 'e2e');

  let specFiles = [];

  if (args.length > 0) {
    specFiles = args.map(arg => {
      if (fs.existsSync(arg)) return arg;
      const e2ePath = path.join('e2e', arg);
      if (fs.existsSync(e2ePath)) return e2ePath;
      return null;
    }).filter(Boolean);

    if (specFiles.length === 0) {
      log(`${colors.red}No valid test suites found for: ${args.join(', ')}${colors.reset}`);
      process.exit(1);
    }
  } else {
    specFiles = fs.readdirSync(e2eDir)
      .filter(file => file.endsWith('.spec.ts'))
      .map(file => path.join('e2e', file));
  }

  log(`${colors.bright}${colors.blue}========================================`);
  log(`Running E2E tests with smart retry`);
  log(`========================================${colors.reset}\n`);

  log(`${colors.bright}Suites to run:${colors.reset}`);
  specFiles.forEach(f => log(`  - ${f}`, colors.gray));
  log('');

  const reports = [];

  // Helper function for delay
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < specFiles.length; i++) {
    const specFile = specFiles[i];

    // Add a small delay between suites to allow for cleanup/port release
    if (i > 0) {
      await wait(2000);
    }

    const totalTests = await countTestsInSpec(specFile);
    if (totalTests === 0) continue;

    process.stdout.write(`${colors.cyan}[Running]${colors.reset} ${specFile} (${totalTests} tests) ... `);

    // Initial Run (Silent) - Uses JSON reporter for reliability
    // We append --reporter=json to the arguments
    const result = await runSilentCommand('npx', ['playwright', 'test', specFile, '--reporter=json']);

    if (result.code === 0) {
      log(`${colors.green}PASSED${colors.reset} ${colors.gray}(${formatDuration(result.duration)})${colors.reset}`);
      reports.push({ file: specFile, failures: [], status: 'passed' });
      continue;
    }

    // Parse JSON output for robust failure detection
    let failingTests = parsePlaywrightJSON(result.stdout);

    // Fallback: If JSON contained no failures (process crash?) but code != 0, try text parsing?
    // Actually, if we ran with --reporter=json, simple text parsing won't work well on the JSON blob.
    // If failures is 0 but code != 0, it might be a setup error or crash.
    if (failingTests.length === 0) {
      log(`${colors.red}FAILED (Crash/Setup Error)${colors.reset}`);
      // If crash, we might want to show logs immediately?
      // Let's treat it as "needs retry" but we don't know which test.
      // We'll set 100% failure rate behavior.
      failingTests = [{ testName: "Unknown (Process Failed)", file: specFile }];
    } else {
      log(`\n  ${colors.yellow}⚠ Failed ${failingTests.length} tests. Retrying...${colors.reset}`);
    }

    const failureRate = failingTests.length / totalTests;
    // log(`Failure rate: ${(failureRate * 100).toFixed(1)}%`);

    let finalFailures = [];

    if (failureRate < 0.5 && failingTests[0].testName !== "Unknown (Process Failed)") {
      // Retrying individual tests
      log(`${colors.yellow}Less than 50% failing. Retrying failed tests individually...${colors.reset}`);
      for (const test of failingTests) {
        log(`${colors.cyan}Retrying individual test: ${test.testName}${colors.reset}`);
        const testNameEscaped = test.testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Retry with default reporter to get readable logs if it fails again
        const retryResult = await runCommandWithConditionalOutput('npx', [
          'playwright',
          'test',
          specFile, // Use specFile + grep
          '-g',
          testNameEscaped,
        ]);

        if (retryResult.code !== 0) {
          log(`${colors.red}✗ Test still failing: ${test.testName}${colors.reset}`);
          finalFailures.push(test);
        } else {
          log(`${colors.green}✓ Test passed on retry: ${test.testName}${colors.reset}`);
        }
      }
    } else {
      // Rerunning entire suite
      log(`${colors.yellow}50% or more failing (or crash). Rerunning entire suite...${colors.reset}`);

      // Retry with default reporter (text) for debugging
      const retryResult = await runCommandWithConditionalOutput('npx', ['playwright', 'test', specFile]);

      if (retryResult.code !== 0) {
        log(`${colors.red}Spec still failing after suite rerun.${colors.reset}`);
        // Now parse the TEXT output of the retry to find what remains failing
        finalFailures = parsePlaywrightText(retryResult.stdout + '\n' + retryResult.stderr);
        if (finalFailures.length === 0) {
          // Still crashed or no tests found in output?
          finalFailures = [{ testName: "Suite Failed (Unknown Error)", file: specFile }];
        }
      } else {
        log(`${colors.green}✓ Suite passed on retry!${colors.reset}`);
        finalFailures = [];
      }
    }

    if (finalFailures.length === 0) {
      log(`${colors.green}✓ All tests in ${specFile} passed after retry!${colors.reset}\n`);
      reports.push({ file: specFile, failures: [], status: 'passed' });
    } else {
      log(`${colors.red}✗ ${finalFailures.length} test(s) still failing in ${specFile}${colors.reset}\n`);
      reports.push({ file: specFile, failures: finalFailures, status: 'failed' });
    }
  }

  // Final Report
  log(`\n${colors.bright}${colors.blue}========================================`);
  log(`FINAL TEST REPORT`);
  log(`========================================${colors.reset}\n`);

  let anyFailed = false;
  reports.forEach(report => {
    if (report.status === 'passed') {
      log(`${colors.green}✓ ${report.file}: PASSED${colors.reset}`);
    } else {
      anyFailed = true;
      log(`${colors.red}✗ ${report.file}: FAILED (${report.failures.length} tests)${colors.reset}`);
      report.failures.forEach(f => {
        log(`    - ${f.testName}`, colors.gray);
      });
    }
  });

  if (anyFailed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Error running tests:', error);
  process.exit(1);
});
