#!/usr/bin/env node
import { shellCommand } from '../commands/shell';
import { buildProgram } from './program';

const program = buildProgram();

// jdf shell — modo interactivo sin PIN repetido
program
  .command('shell')
  .description('Iniciar modo interactivo (PIN una sola vez, escribe "exit" para salir)')
  .action(shellCommand);

program.exitOverride(); // ya está en buildProgram pero por si acaso

program.parseAsync(process.argv).catch(() => {});
