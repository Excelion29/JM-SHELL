import * as path from 'path';
import { JM_DIR, safeEnsureDir, safeWriteFile } from '../refinement/safe-fs';
import { dashboardPath, renderDashboardMarkdown } from '../refinement/state';
import { DASHBOARD_WORK_FILE, workDirFor, writeWorkFile } from '../refinement/workdir';
import { readKnowledgeConfig } from './knowledge-runtime';
import { listAllStories, ResolverOptions } from './story-resolver';

// "Donde te quedaste": con base conectada vive en la carpeta de trabajo; sin base, en .jm del proyecto
export async function refreshDashboard(
  root: string,
  workDir: string = workDirFor(root),
  options: ResolverOptions = {},
): Promise<void> {
  const content = renderDashboardMarkdown(await listAllStories(root, options));
  const config = await readKnowledgeConfig(root);
  if (config && config.type !== 'none') {
    writeWorkFile(workDir, DASHBOARD_WORK_FILE, content);
    return;
  }
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, dashboardPath(root), content);
}
