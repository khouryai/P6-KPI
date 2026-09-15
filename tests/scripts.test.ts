/**
 * Guards on the Windows launcher scripts. These are the only files in the repo
 * that run outside a browser and outside the test suite, and a mistake in one of
 * them reaches the user's disk. An earlier version of "Create Desktop App.cmd"
 * ran `del "%VAR%"` with an unset variable; cmd resolved that to the current
 * directory and offered to delete every file in it. These rules exist so that
 * cannot happen again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const cmdFiles = readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.cmd'));

describe('Windows launcher scripts', () => {
  it('there is at least one launcher to check', () => {
    expect(cmdFiles.length).toBeGreaterThan(0);
  });

  it.each(cmdFiles)('%s never deletes anything', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const offenders: string[] = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/^\s+/, '');
      // Comments explaining the rule are allowed to name the commands.
      if (/^rem\b/i.test(code)) return;
      if (/(^|[|&]\s*)(del|erase|rd|rmdir|format)\s/i.test(code)) offenders.push(`${file}:${i + 1}  ${code.trim()}`);
    });
    expect(offenders, 'destructive command found').toEqual([]);
  });

  it.each(cmdFiles)('%s escapes every bracket inside echo', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const offenders: string[] = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/^\s+/, '');
      if (!/^(>+\s*"[^"]*"\s*)?echo\b/i.test(code)) return;
      // Inside a parenthesised block an unescaped ) closes the block early, even
      // in the middle of a quoted string, which silently changes control flow.
      const stripped = code.replace(/\^[()]/g, '');
      if (/[()]/.test(stripped)) offenders.push(`${file}:${i + 1}  ${code.trim()}`);
    });
    expect(offenders, 'unescaped ( or ) in an echo; write ^( and ^)').toEqual([]);
  });

  it.each(cmdFiles)('%s writes no temporary script files', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(/%TEMP%|%TMP%/i.test(text.replace(/^\s*rem\b.*$/gim, '')), 'writes into TEMP').toBe(false);
  });

  it('the shortcut maker resolves ProgramFiles(x86) before using it', () => {
    const text = readFileSync(resolve(ROOT, 'Create Desktop App.cmd'), 'utf8');
    // The bracket in the variable name breaks for(...) and if(...) blocks, so it
    // may appear exactly once: on the line that copies it into a plain variable.
    const uses = text.split(/\r?\n/).filter((l) => l.includes('%ProgramFiles(x86)%') && !/^\s*rem\b/i.test(l));
    expect(uses.length).toBe(1);
    expect(uses[0]).toMatch(/^\s*set\s+"PFX=/);
  });

  it('the shortcut maker branches with labels, not parenthesised blocks', () => {
    const text = readFileSync(resolve(ROOT, 'Create Desktop App.cmd'), 'utf8');
    const blockOpeners = text.split(/\r?\n/).filter((l) => !/^\s*rem\b/i.test(l) && /^\s*(if|for)\b.*\(\s*$/i.test(l));
    expect(blockOpeners, 'use goto :label instead of a ( block').toEqual([]);
  });

  it('serve.ps1 only reads files and never removes them', () => {
    const ps = readFileSync(resolve(ROOT, 'server/serve.ps1'), 'utf8');
    expect(/Remove-Item|\bdel\b|\brm\b|Clear-Content/i.test(ps)).toBe(false);
    expect(ps).toMatch(/ReadAllBytes/);
  });
});

describe('the updater', () => {
  const ps = readFileSync(resolve(ROOT, 'server/update.ps1'), 'utf8');
  const cmd = readFileSync(resolve(ROOT, 'Update.cmd'), 'utf8');
  // Strip the <# #> header and every # comment: the rules are spelled out in
  // prose up there, and naming a command is not using it.
  const code = ps
    .replace(/<#[\s\S]*?#>/g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it('deletes only the download staging folder', () => {
    const removals = code.split(/\r?\n/).filter((l) => /Remove-Item/i.test(l));
    expect(removals.length, 'exactly one deletion, and it is the staging folder').toBe(1);
    expect(removals[0]).toMatch(/-LiteralPath \$staging\b/);
  });

  it('guards that deletion on the path really being the staging folder', () => {
    const fn = /function Remove-Staging \{([\s\S]*?)\n\}/.exec(code);
    expect(fn, 'Remove-Staging must exist and be the only place that deletes').not.toBeNull();
    const body = fn![1];
    // Every one of these must hold before a single byte is removed. The rule
    // exists because an unset variable once resolved to the current directory.
    expect(body).toMatch(/IsNullOrWhiteSpace\(\$staging\)/);
    expect(body).toMatch(/IsNullOrWhiteSpace\(\$tempBase\)/);
    expect(body).toMatch(/\$staging\.StartsWith\(\$tempBase/);
    expect(body).toMatch(/\$staging\.Length -le/);
    expect(body).toMatch(/tc-budget-update-/);
    expect(body).toMatch(/Test-Path -LiteralPath \$staging/);
  });

  it('never removes anything under the application folder', () => {
    // Copy over the top, never clear out first. A file the new build no longer
    // ships is clutter; a wrong delete is someone's work.
    expect(/Remove-Item[^\n]*\$AppDir/i.test(code)).toBe(false);
    expect(/Clear-Content|Remove-ItemProperty/i.test(code)).toBe(false);
  });

  it('verifies the download before copying anything out of it', () => {
    const verifyAt = code.indexOf('$missing');
    const copyAt = code.indexOf('Copy-WithRetry');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(copyAt).toBeGreaterThan(verifyAt);
  });

  it('refuses to copy over a git clone it cannot pull', () => {
    expect(code).toMatch(/hasGitDir -and -not \$gitExe/);
  });

  it('runs the updater on the last line Update.cmd can safely read', () => {
    const lines = cmd
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^rem\b/i.test(l) && !/^:/.test(l));
    const run = lines.filter((l) => /^powershell\b/i.test(l) && /update\.ps1/i.test(l));
    expect(run.length, 'exactly one line invokes update.ps1').toBe(1);
    // update.ps1 may replace Update.cmd while it runs, and cmd reads a batch file
    // by byte offset. Chaining pause and exit onto the same line means cmd never
    // returns to the file to find different bytes there.
    expect(run[0]).toMatch(/&\s*pause\s*&\s*exit \/b\s*$/);
    expect(lines.indexOf(run[0])).toBeLessThan(lines.length);
    const after = lines.slice(lines.indexOf(run[0]) + 1);
    // Anything after it is only reachable by a goto taken before the swap.
    expect(after.every((l) => /^(echo|goto|pause|endlocal)\b/i.test(l)), `unreachable-after lines: ${after.join(' | ')}`).toBe(true);
  });

  it('points at a real branch of a real repo', () => {
    const cfg = JSON.parse(readFileSync(resolve(ROOT, 'server/update.json'), 'utf8'));
    expect(cfg.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(typeof cfg.branch).toBe('string');
    expect(cfg.branch.length).toBeGreaterThan(0);
  });
});
