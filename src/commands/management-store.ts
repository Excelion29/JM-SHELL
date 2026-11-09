import * as fs from 'fs-extra';
import * as path from 'path';
import { PROJECT_CONFIG_NAME } from '../config/loader';
import { writeFileAtomicNoLinks } from '../utils/safe-write';
import { managementStatusOf, withManagement } from '../refinement/management';
import type { ManagementIssue, ManagementStatus } from '../refinement/management-types';

type ProjectFile = Record<string, unknown>;

async function readProjectFile(root: string): Promise<ProjectFile | null> {
  const file = path.join(root, PROJECT_CONFIG_NAME);
  return (await fs.pathExists(file)) ? ((await fs.readJson(file)) as ProjectFile) : null;
}

export async function readManagement(root: string, projectKey: string): Promise<ManagementStatus> {
  return managementStatusOf(await readProjectFile(root), projectKey);
}

// Solo cambia el valor de este proyecto: el resto del .jira.json queda como estaba
export async function saveManagement(root: string, projectKey: string, value: ManagementIssue | null): Promise<void> {
  const project = await readProjectFile(root);
  if (!project) throw new Error(`No hay ${PROJECT_CONFIG_NAME} en esta carpeta.`);
  writeFileAtomicNoLinks(
    path.join(root, PROJECT_CONFIG_NAME),
    `${JSON.stringify(withManagement(project, projectKey, value), null, 2)}\n`,
  );
}
