const ISSUE_KEY_STRICT = /^[A-Z][A-Z0-9_]+-\d+$/;
// Más laxo que el estricto: los comandos clásicos aceptan claves en minúsculas, pero nunca ruta ni query
const PATH_SAFE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const PATH_SAFE_PROJECT = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isValidIssueKey(key: string): boolean {
  return ISSUE_KEY_STRICT.test(key);
}

// Se valida antes de interpolar una clave en una ruta REST: evita `../` y `?` en la URL
export function pathKey(key: string): string {
  if (!PATH_SAFE_KEY.test(key)) throw new Error(`Clave de issue inválida: "${key}".`);
  return key;
}

export function pathProject(key: string): string {
  if (!PATH_SAFE_PROJECT.test(key)) throw new Error(`Clave de proyecto inválida: "${key}".`);
  return key;
}
