import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { error, info } from '../utils/format';
import chalk from 'chalk';

export async function projectsCommand(): Promise<void> {
  const globalConfig = await requireAuth();
  const jira = new JiraService(globalConfig);

  let projects;
  try {
    projects = await jira.getProjects();
  } catch (err: unknown) {
    error(`Error al obtener proyectos: ${(err as Error).message}`);
    process.exit(1);
  }

  if (projects.length === 0) {
    info('No se encontraron proyectos.');
    return;
  }

  console.log(chalk.bold(`\n  ${projects.length} proyecto(s) disponible(s):\n`));
  for (const p of projects) {
    console.log(
      `  ${chalk.bold.cyan(p.key.padEnd(14))} ${p.name} ${chalk.dim(`(${p.projectTypeKey})`)}`
    );
  }
  console.log('');
}
