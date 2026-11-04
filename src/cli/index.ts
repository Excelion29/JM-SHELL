#!/usr/bin/env node
import { shellCommand } from '../commands/shell';
import { appCommand } from '../commands/app';
import { buildProgram } from './program';

const program = buildProgram();

// jdf shell — modo interactivo sin PIN repetido
program
  .command('shell')
  .description('Iniciar modo interactivo (PIN una sola vez, escribe "exit" para salir)')
  .action(shellCommand);

// jdf app — app de terminal (también se abre con `jdf` sin argumentos)
program
  .command('app')
  .description('Abrir la app de terminal de DevFlow')
  .action(appCommand);

program.exitOverride(); // ya está en buildProgram pero por si acaso

const args = process.argv.length > 2 ? process.argv : [...process.argv, 'app'];

program.parseAsync(args).catch(() => {});
