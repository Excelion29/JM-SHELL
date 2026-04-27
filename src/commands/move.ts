import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { transitionWithFallback } from '../utils/transition';
import { error } from '../utils/format';

export async function moveCommand(issueArg: string | undefined, statusName: string): Promise<void> {
  const globalConfig = await requireAuth();

  let issueKey;
  try {
    issueKey = await resolveIssueKey(issueArg);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);
  await transitionWithFallback(jira, issueKey, statusName);
}
