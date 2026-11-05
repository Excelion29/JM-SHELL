import { assertKey, projectRoot } from './state';

// jm solo usa la carpeta donde se abrió: ahí viven el estado de la historia y el cwd de Claude
export function storyRootFor(storyKey: string): string {
  assertKey(storyKey);
  return projectRoot();
}
