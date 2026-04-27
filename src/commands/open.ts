import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { info, error } from '../utils/format';
import chalk from 'chalk';
import openBrowser from 'open';

interface OpenOptions {
  browser?: boolean;
}

export async function openCommand(issueArg?: string, options: OpenOptions = {}): Promise<void> {
  const globalConfig = await requireAuth();

  let issueKey;
  try {
    issueKey = await resolveIssueKey(issueArg);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);
  const url = jira.getBrowseUrl(issueKey);

  console.log(chalk.underline.blue(url));

  if (options.browser !== false) {
    try {
      await openBrowser(url);
      info('Abierto en el navegador');
    } catch {
      info('No se pudo abrir el navegador automáticamente. Copia la URL de arriba.');
    }
  }
}
