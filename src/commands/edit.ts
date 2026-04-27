import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { parseTime } from '../utils/time';
import { success, error, info } from '../utils/format';
import { transitionWithFallback } from '../utils/transition';
import chalk from 'chalk';

interface EditOptions {
  title?: string;
  estimate?: string;
  due?: string;
  assign?: string;
  status?: string;
}

export async function editCommand(issueArg: string | undefined, options: EditOptions): Promise<void> {
  const globalConfig = await requireAuth();

  let issueKey;
  try {
    issueKey = await resolveIssueKey(issueArg);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);
  const fields: Record<string, unknown> = {};
  let hasFieldUpdates = false;

  if (options.title) { fields.summary = options.title; hasFieldUpdates = true; }

  if (options.estimate) {
    try {
      const secs = parseTime(options.estimate);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      const estimate = parts.join(' ') || '0m';
      fields.timetracking = { originalEstimate: estimate, remainingEstimate: estimate };
      hasFieldUpdates = true;
    } catch (err: unknown) {
      error((err as Error).message);
      process.exit(1);
    }
  }

  if (options.due) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.due)) {
      error('La fecha de vencimiento debe tener formato YYYY-MM-DD');
      process.exit(1);
    }
    fields.duedate = options.due;
    hasFieldUpdates = true;
  }

  if (options.assign) { fields.assignee = { accountId: options.assign }; hasFieldUpdates = true; }

  if (!hasFieldUpdates && !options.status) {
    info('No se especificaron cambios. Usa --title, --estimate, --due, --assign o --status.');
    return;
  }

  if (hasFieldUpdates) {
    try {
      await jira.updateIssue(issueKey, fields);
      success(`Actualizado ${chalk.bold(issueKey)}`);
    } catch (err: unknown) {
      error(`Error al actualizar el issue: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (options.status) {
    await transitionWithFallback(jira, issueKey, options.status);
  }
}
