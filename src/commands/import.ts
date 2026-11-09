import inquirer from 'inquirer';
import chalk from 'chalk';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { error, info, success, warn } from '../utils/format';
import { formatSeconds } from '../utils/time';
import { buildPreview, defaultAssignee, findExistingMatches, resolveTarget, runCreation } from '../refinement/create';
import { projectKeyOfStory } from '../refinement/repos';
import type { AskReason, CreationTarget, ParentOutcome } from '../refinement/review-types';
import { assertKey, isValidIssueKey, projectRoot, readState } from '../refinement/state';
import { refreshDashboard } from './dashboard';
import { configuredAssignee } from './assignee';
import { openStory } from './story-resolver';

const ASK_REASONS: Record<AskReason, string> = {
  epic: 'es una épica',
  subtask: 'es una subtarea',
  done: 'ya está cerrada',
  'not-found': 'no existe en Jira',
};

type AskChoice = 'epic' | 'other' | 'cancel';

async function askTarget(
  jira: JiraService,
  storyKey: string,
  parent: Extract<ParentOutcome, { kind: 'ask' }>,
): Promise<CreationTarget | null> {
  warn(`${storyKey} ${ASK_REASONS[parent.reason]}: elige dónde crear las tareas.`);
  const choices = [
    ...(parent.epicKey ? [{ name: `Dentro de la épica ${parent.epicKey} (issues estándar)`, value: 'epic' }] : []),
    { name: 'Dentro de otra clave', value: 'other' },
    { name: 'Cancelar', value: 'cancel' },
  ];
  const { choice } = await inquirer.prompt<{ choice: AskChoice }>([
    { type: 'list', name: 'choice', message: 'Dónde crear las tareas:', choices },
  ]);
  if (choice === 'cancel') return null;
  let parentKey = parent.epicKey ?? '';
  if (choice === 'other') {
    const answer = await inquirer.prompt<{ key: string }>([
      {
        type: 'input',
        name: 'key',
        message: 'Clave del padre (ej. AQ-12):',
        filter: (value: string) => value.trim().toUpperCase(),
        validate: (value: string) => isValidIssueKey(value) || 'Usa el formato AQ-45.',
      },
    ]);
    parentKey = answer.key;
  }
  const result = await resolveTarget(jira, parentKey);
  if (!result.ok) throw new Error(result.message);
  return result.target;
}

export async function importCommand(issueKeyArg?: string): Promise<void> {
  try {
    const key = await resolveIssueKey(issueKeyArg);
    assertKey(key);
    const jira = new JiraService(await requireAuth());
    const root = projectRoot();
    const { store } = await openStory(root, key);
    if (!(await readState(store, key)))
      throw new Error(`La historia ${key} aún no tiene plan. Ejecuta \`jm refinar ${key}\`.`);

    const assignee = await defaultAssignee(jira, projectKeyOfStory(key), await configuredAssignee());
    const preview = await buildPreview(jira, store, key, assignee);
    if (!preview.taskCount) throw new Error('No hay tareas marcadas en el plan. Revísalo en `jm` (tecla r).');
    const target = preview.parent.kind === 'ready' ? preview.parent.target : await askTarget(jira, key, preview.parent);
    if (!target) {
      info('No se creó nada.');
      return;
    }

    const existing =
      preview.parent.kind === 'ready' ? preview.existing : await findExistingMatches(jira, store, key, target);
    console.log(
      chalk.bold(`\n  Se crearán ${preview.taskCount} tarea(s) · estimado ${formatSeconds(preview.estimateSeconds)}`),
    );
    console.log(`  Padre: ${target.parentKey} — ${target.parentSummary}`);
    console.log(`  Tipo: ${target.issueTypeName}`);
    console.log(`  Responsable: ${assignee.displayName}`);
    console.log(`  Adjuntos a subir: ${preview.uploads.length}`);
    if (existing.length) {
      console.log(chalk.yellow('  Ya existen en Jira con el mismo título (se vincularán, no se crearán):'));
      for (const m of existing) console.log(`    ${m.key} · ${m.summary}`);
    }
    console.log();
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      { type: 'confirm', name: 'confirmed', message: '¿Crear en Jira?', default: false },
    ]);
    if (!confirmed) {
      info('No se creó nada.');
      return;
    }

    const outcome = await runCreation(
      { jira, store },
      key,
      { target, assigneeId: assignee.accountId, adopt: Object.fromEntries(existing.map((m) => [m.taskId, m.key])) },
      (progress) =>
        info(`[${progress.index}/${progress.total}] ${progress.step} ${progress.detail ?? progress.summary}`),
    );
    if (!outcome.ok) {
      error(outcome.message);
      info(`Siguiente paso: vuelve a ejecutar \`jm import ${key}\`; continúa donde se cortó.`);
      process.exit(1);
    }
    await refreshDashboard(root);
    if (outcome.estimateSkipped) warn('Jira no acepta estimación en este proyecto: se crearon sin ella.');
    for (const created of outcome.created) success(`${chalk.bold(created.key)} — ${created.summary}`);
    info(`Siguiente paso: abre el padre con \`jm open ${outcome.parentKey}\`.`);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }
}
