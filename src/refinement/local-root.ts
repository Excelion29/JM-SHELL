import * as os from 'os';
import * as path from 'path';

const WINDOWS_PLATFORM = 'win32';
const PARENT_SEGMENT = '..';
const JIRA_TOOL_DIR = '.jira-tool';

// Windows no distingue mayúsculas en rutas: se compara en minúsculas y ya resuelta
export const comparablePath = (target: string): string => {
  const resolved = path.resolve(target);
  return process.platform === WINDOWS_PLATFORM ? resolved.toLowerCase() : resolved;
};

// true si `child` es `parent` o está dentro
export function isSameOrInside(parent: string, child: string): boolean {
  const relative = path.relative(comparablePath(parent), comparablePath(child));
  if (relative === '') return true;
  return (
    relative !== PARENT_SEGMENT && !relative.startsWith(`${PARENT_SEGMENT}${path.sep}`) && !path.isAbsolute(relative)
  );
}

export const isDriveRoot = (target: string): boolean => {
  const resolved = path.resolve(target);
  return path.parse(resolved).root === resolved;
};

// La carpeta del usuario, cualquiera de sus ancestros o la raíz de un disco no son una carpeta de proyecto ni de base
export const isHomeOrAbove = (target: string, home: string = os.homedir()): boolean =>
  isDriveRoot(target) || isSameOrInside(target, home);

export function assertLocalRootAllowed(root: string, home: string = os.homedir()): void {
  if (isHomeOrAbove(root, home) || isSameOrInside(root, path.join(home, JIRA_TOOL_DIR)))
    throw new Error(
      `La carpeta "${root}" es demasiado amplia (tu carpeta de usuario, un ancestro, la raíz de un disco o donde viven tus secretos de jm). Elige una carpeta específica para la base.`,
    );
}
