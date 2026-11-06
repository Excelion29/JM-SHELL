import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomicNoLinks } from '../utils/safe-write';

export type TransitionTarget = 'start' | 'done';

export interface TransitionMemory {
  get: (projectKey: string, target: TransitionTarget) => string | undefined;
  set: (projectKey: string, target: TransitionTarget, name: string) => void;
}

const MEMORY_FILE = 'transiciones.json';
const TARGETS: readonly TransitionTarget[] = ['start', 'done'];
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;
const MAX_NAME_LENGTH = 100;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

type Stored = Record<string, Partial<Record<TransitionTarget, string>>>;

const isValidName = (name: unknown): name is string =>
  typeof name === 'string' && name.trim() !== '' && name.length <= MAX_NAME_LENGTH && !CONTROL_CHARS.test(name);

function readStored(file: string): Stored {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {}; // sin archivo o ilegible: se vuelve a preguntar y se reescribe
  }
  const clean: Stored = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return clean;
  for (const [project, entry] of Object.entries(raw)) {
    if (!PROJECT_KEY_PATTERN.test(project) || typeof entry !== 'object' || entry === null) continue;
    for (const target of TARGETS) {
      const name = (entry as Record<string, unknown>)[target];
      if (isValidName(name)) clean[project] = { ...clean[project], [target]: name };
    }
  }
  return clean;
}

// Solo nombres de transición por proyecto: ningún secreto. `dir` solo cambia en las pruebas
export function createFileTransitionMemory(dir: string = path.join(os.homedir(), '.jira-tool')): TransitionMemory {
  const file = path.join(dir, MEMORY_FILE);
  return {
    get: (projectKey, target) => readStored(file)[projectKey]?.[target],
    set: (projectKey, target, name) => {
      if (!PROJECT_KEY_PATTERN.test(projectKey) || !isValidName(name)) return;
      const stored = readStored(file);
      stored[projectKey] = { ...stored[projectKey], [target]: name };
      fs.mkdirSync(dir, { recursive: true });
      writeFileAtomicNoLinks(file, JSON.stringify(stored, null, 2));
    },
  };
}
