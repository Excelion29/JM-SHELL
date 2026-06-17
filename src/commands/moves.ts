import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { error, info } from '../utils/format';
import chalk from 'chalk';

export async function movesCommand(issueArg?: string): Promise<void> {
  const globalConfig = await requireAuth();

  let issueKey;
  try {
    issueKey = await resolveIssueKey(issueArg);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);

  try {
    const transitions = await jira.getTransitions(issueKey);
    
    if (transitions.length === 0) {
      info(`No hay transiciones disponibles para ${chalk.bold(issueKey)}.`);
      return;
    }

    console.log(`\nTransiciones disponibles para ${chalk.bold.cyan(issueKey)}:`);
    transitions.forEach((t) => {
      console.log(`  ${chalk.green('→')} ${chalk.yellow(t.name)}`);
    });
    console.log(`\nUsa ${chalk.bold('move <estado>')} para cambiarlo.\n`);
  } catch (err: unknown) {
    error(`Error al obtener las transiciones: ${(err as Error).message}`);
    process.exit(1);
  }
}
