import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { error } from '../utils/format';
import { transitionWithFallback } from '../utils/transition';
import chalk from 'chalk';

export async function startCommand(issueArg?: string): Promise<void> {
  const globalConfig = await requireAuth();

  let issueKey;
  try {
    issueKey = await resolveIssueKey(issueArg);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);

  await transitionWithFallback(jira, issueKey, 'In Progress');
  console.log(chalk.underline.blue(jira.getBrowseUrl(issueKey)));
}
