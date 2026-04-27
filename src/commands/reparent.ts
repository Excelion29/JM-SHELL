import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { success, error, info } from '../utils/format';
import chalk from 'chalk';

export async function reparentCommand(issueKey: string, newParentKey: string): Promise<void> {
  const globalConfig = await requireAuth();
  const jira = new JiraService(globalConfig);

  try {
    const parent = await jira.getIssue(newParentKey);
    info(`Nuevo padre: [${parent.key}] ${parent.fields.summary}`);
  } catch (err: unknown) {
    error(`Issue padre ${newParentKey} no encontrado: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    await jira.reparent(issueKey, newParentKey);
    success(`${chalk.bold(issueKey)} reasignado a ${chalk.bold(newParentKey)}`);
    console.log(chalk.underline.blue(jira.getBrowseUrl(issueKey)));
  } catch (err: unknown) {
    error(`Error al reasignar: ${(err as Error).message}`);
    process.exit(1);
  }
}
