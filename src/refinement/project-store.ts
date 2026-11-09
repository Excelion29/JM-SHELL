import * as path from 'path';
import { ANALYSIS_DIR } from './analysis';
import { ensureGitExclude } from './git-exclude';
import { createLocalStore } from './local-store';
import { legacyStoryDir, renameLegacyChat } from './migrate';
import { JM_DIR } from './safe-fs';
import { ensureJmGitignore } from './state';
import type { StoryStore } from './story-store';

// Sin base de conocimiento: la historia vive en .jm/historias/<KEY> del proyecto, ignorada por git sin tocar el .gitignore del equipo
export function createProjectStore(root: string, key: string): StoryStore {
  const dir = legacyStoryDir(root, key);
  return createLocalStore({
    kind: 'project',
    anchor: path.join(root, JM_DIR),
    dir,
    prepare: () => {
      ensureJmGitignore(root);
      ensureGitExclude(root);
      renameLegacyChat(dir);
    },
  });
}

// Sin base de conocimiento: el análisis sin historia vive en .jm/analisis/<id>, también ignorada por git
export function createAnalysisProjectStore(root: string, id: string): StoryStore {
  return createLocalStore({
    kind: 'project',
    anchor: path.join(root, JM_DIR),
    dir: path.join(root, JM_DIR, ANALYSIS_DIR, id),
    prepare: () => {
      ensureJmGitignore(root);
      ensureGitExclude(root);
    },
  });
}
