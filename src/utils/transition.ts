import inquirer from 'inquirer';
import { JiraService, TransitionNotFoundError } from '../services/jira';
import { success, info, error } from './format';
import chalk from 'chalk';

export async function transitionWithFallback(
  jira: JiraService,
  issueKey: string,
  statusName: string
): Promise<void> {
  try {
    const applied = await jira.transitionToStatus(issueKey, statusName);
    success(`${chalk.bold(issueKey)} → ${chalk.yellow(applied)}`);
  } catch (err: unknown) {
    if (err instanceof TransitionNotFoundError) {
      if (err.available.length === 0) {
        error(`No hay transiciones disponibles para ${issueKey}.`);
        process.exit(1);
      }

      info(`Estado "${err.attempted}" no encontrado. Elige uno disponible:`);

      const { chosen } = await inquirer.prompt([
        {
          type: 'list',
          name: 'chosen',
          message: 'Nuevo estado:',
          choices: err.available.map((name) => ({ name, value: name })),
        },
      ]);

      const applied = await jira.transitionToStatus(issueKey, chosen);
      success(`${chalk.bold(issueKey)} → ${chalk.yellow(applied)}`);
    } else {
      error((err as Error).message);
      process.exit(1);
    }
  }
}
