import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { globalConfigExists, loadGlobalConfig } from '../config/loader';
import { setSession, clearSession } from '../utils/session';
import { buildProgram } from '../cli/program';
import { error, success } from '../utils/format';

class CommandAborted extends Error {}

const HISTORY_FILE = path.join(os.homedir(), '.jira-tool', 'shell_history');
const MAX_HISTORY = 200;

async function loadHistory(): Promise<string[]> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function saveHistory(history: string[]): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(HISTORY_FILE));
    await fs.writeFile(HISTORY_FILE, history.slice(-MAX_HISTORY).join('\n'));
  } catch { /* no fatal */ }
}

export async function shellCommand(): Promise<void> {
  const configured = await globalConfigExists();
  if (!configured) {
    error('No inicializado. Ejecuta `jdf init` primero.');
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n  DevFlow — Modo interactivo'));
  console.log(chalk.dim('  Usa ↑ ↓ para navegar el historial. "exit" para salir.\n'));

  const { pin } = await inquirer.prompt([{
    type: 'password',
    name: 'pin',
    message: 'PIN:',
    mask: '*',
    validate: (val: string) => val.length >= 4 ? true : 'Mínimo 4 caracteres',
  }]);

  let config;
  try {
    config = await loadGlobalConfig(pin);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  setSession(config);
  success(`Sesión iniciada. Escribe "exit" para cerrar.\n`);

  // Cargar historial persistido de sesiones anteriores
  // readline espera el historial en orden inverso (más reciente primero)
  const persistedHistory = await loadHistory();
  let history: string[] = [...persistedHistory].reverse();

  // ── Interceptar process.exit ──────────────────────────────────
  const realExit = process.exit.bind(process);
  let intentionalExit = false;

  (process.exit as unknown as (code?: number) => never) = (code?: number) => {
    if (intentionalExit || code === 0) {
      clearSession();
      realExit(code ?? 0);
    }
    throw new CommandAborted();
  };

  while (true) {
    const { line, updatedHistory } = await askLine(history);
    history = updatedHistory;

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'exit' || trimmed === 'salir' || trimmed === 'quit') {
      intentionalExit = true;
      clearSession();
      process.exit = realExit;
      // Guardar historial (orden cronológico: más antiguo primero)
      await saveHistory([...history].reverse());
      console.log(chalk.dim('\n  Sesión cerrada. ¡Hasta luego!\n'));
      realExit(0);
    }

    const args = parseArgs(trimmed);
    const program = buildProgram();

    try {
      await program.parseAsync(['node', 'jdf', ...args]);
    } catch (err: unknown) {
      if (err instanceof CommandAborted) {
        // Comando fallido — continuar el shell
      } else {
        const e = err as { code?: string; message?: string };
        if (!e.code?.startsWith('commander.')) {
          error(e.message ?? String(err));
        }
      }
    }

    console.log();
  }
}

function askLine(history: string[]): Promise<{ line: string; updatedHistory: string[] }> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    // Pasamos el historial acumulado — readline lo usa para ↑ ↓
    history: [...history],
    historySize: MAX_HISTORY,
  });

  return new Promise((resolve) => {
    rl.question(chalk.cyan('jdf') + chalk.dim('> '), (answer) => {
      // rl.history tiene el historial actualizado en orden inverso
      const updatedHistory = (rl as unknown as { history: string[] }).history ?? history;
      rl.close();
      resolve({ line: answer, updatedHistory: [...updatedHistory] });
    });
  });
}

function parseArgs(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (const ch of line) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }

  if (current) args.push(current);
  return args;
}
