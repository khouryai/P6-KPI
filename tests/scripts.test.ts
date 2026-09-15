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
