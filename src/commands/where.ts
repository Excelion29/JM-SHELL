import { loadProjectConfig, loadContext } from '../config/loader';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import chalk from 'chalk';

export async function whereCommand(): Promise<void> {
  console.log('');

  try {
    const project = await loadProjectConfig();
    console.log(`${chalk.gray('Proyecto:')}   ${chalk.bold(project.projectKey)}`);
  } catch {
    console.log(`${chalk.gray('Proyecto:')}   ${chalk.dim('Sin .jira.json — ejecuta jdf init')}`);
  }

  console.log(`${chalk.gray('Directorio:')} ${process.cwd()}`);

  try {
    const global = await requireAuth();
    console.log(`${chalk.gray('Jira URL:')}   ${chalk.underline.blue(global.jiraUrl)}`);
  } catch {
    console.log(`${chalk.gray('Jira URL:')}   ${chalk.dim('No configurado — ejecuta jdf init')}`);
  }

  const ctx = await loadContext();
  if (ctx) {
    console.log(`${chalk.gray('Contexto:')}   ${chalk.bold.cyan(ctx.issueKey)}`);
  } else {
    try {
      const key = await resolveIssueKey();
      console.log(`${chalk.gray('Contexto:')}   ${chalk.bold.cyan(key)} ${chalk.dim('(del branch de git)')}`);
    } catch {
      console.log(`${chalk.gray('Contexto:')}   ${chalk.dim('Ninguno — ejecuta jdf use <CLAVE>')}`);
    }
  }

  console.log('');
}
