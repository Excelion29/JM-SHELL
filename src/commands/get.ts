import { JiraService } from '../services/jira';
import { resolveIssueKey } from '../utils/context';
import { requireAuth } from '../utils/auth';
import { formatIssue, error } from '../utils/format';

export async function getCommand(issueArg?: string): Promise<void> {
  const globalConfig = await requireAuth();

  let issueKey;
  try {
    issueKey = await resolveIssueKey(issueArg);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);

  let issue;
  try {
    issue = await jira.getIssue(issueKey);
  } catch (err: unknown) {
    error(`Error al obtener el issue: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log('\n' + formatIssue(issue, globalConfig.jiraUrl) + '\n');
}
