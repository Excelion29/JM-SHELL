import { execSync } from 'child_process';
import { loadContext } from '../config/loader';

const ISSUE_KEY_PATTERN = /([A-Z]+-\d+)/;

export async function resolveIssueKey(arg?: string): Promise<string> {
  // 1. Argumento directo
  if (arg && ISSUE_KEY_PATTERN.test(arg)) {
    return arg.match(ISSUE_KEY_PATTERN)![1];
  }

  // 2. .jira-context.json
  const ctx = await loadContext();
  if (ctx?.issueKey) return ctx.issueKey;

  // 3. Nombre del branch de git
  const branch = getCurrentBranch();
  if (branch) {
    const match = branch.match(ISSUE_KEY_PATTERN);
    if (match) return match[1];
  }

  throw new Error(
    'No se encontró ningún ticket. Proporciona uno como argumento, usa `jdf use <CLAVE>`, o usa un branch de git con formato feature/AUTH-123.'
  );
}

function getCurrentBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}
