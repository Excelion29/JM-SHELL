import * as readline from 'readline';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { globalConfigExists, loadGlobalConfig } from '../config/loader';
import { setSession, clearSession } from '../utils/session';
import { buildProgram } from '../cli/program';
import { error, success } from '../utils/format';

export async function shellCommand(): Promise<void> {
  const configured = await globalConfigExists();
  if (!configured) {
    error('No inicializado. Ejecuta `jdf init` primero.');
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n  DevFlow — Modo interactivo'));
  console.log(chalk.dim('  Escribe un comando (sin "jdf") o "exit" para salir.\n'));

  const { pin } = await inquirer.prompt([
    {
      type: 'password',
      name: 'pin',
      message: 'PIN:',
      mask: '*',
      validate: (val: string) => val.length >= 4 ? true : 'Mínimo 4 caracteres',
    },
  ]);

  let config;
  try {
    config = await loadGlobalConfig(pin);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  setSession(config);
  success(`Sesión iniciada. Escribe "exit" para cerrar.\n`);

  // Loop: pedimos input manualmente después de cada comando,
  // así inquirer no interfiere con el readline.
  while (true) {
    const line = await askLine();

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'exit' || trimmed === 'salir' || trimmed === 'quit') {
      clearSession();
      console.log(chalk.dim('\n  Sesión cerrada. ¡Hasta luego!\n'));
      process.exit(0);
    }

    const args = parseArgs(trimmed);
    const program = buildProgram();

    try {
      await program.parseAsync(['node', 'jdf', ...args]);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (!e.code?.startsWith('commander.')) {
        error(e.message ?? String(err));
      }
    }

    console.log();
  }
}

// Pide una línea de input sin dejar readline abierto entre comandos.
// Esto evita que inquirer cierre el stream compartido.
function askLine(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Evitar que Ctrl+C cierre el proceso — solo limpia la línea
  rl.on('SIGINT', () => {
    rl.close();
    console.log();
    process.emit('SIGINT');
  });

  return new Promise((resolve) => {
    rl.question(chalk.cyan('jdf') + chalk.dim('> '), (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Parsea respetando comillas simples y dobles
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
