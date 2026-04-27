import chalk from 'chalk';

interface CommandEntry {
  cmd: string;
  description: string;
  example?: string;
}

const COMMANDS: CommandEntry[] = [
  {
    cmd: 'init',
    description: 'Configurar credenciales, PIN y proyecto de Jira',
    example: 'jdf init',
  },
  {
    cmd: 'projects',
    description: 'Listar todos los proyectos disponibles',
    example: 'jdf projects',
  },
  {
    cmd: 'do <resumen> <tiempo>',
    description: 'Crear una tarea, asignarla y moverla a In Progress',
    example: 'jdf do "Arreglar bug de login" 1h30m --due 2026-04-30',
  },
  {
    cmd: 'get [CLAVE]',
    description: 'Ver detalles de un issue',
    example: 'jdf get AUTH-123',
  },
  {
    cmd: 'edit [CLAVE]',
    description: 'Editar campos de un issue (título, estimado, fecha, estado)',
    example: 'jdf edit AUTH-123 --estimate 2h --due 2026-05-01 --status "In Review"',
  },
  {
    cmd: 'list [PADRE]',
    description: 'Listar issues de un padre, del proyecto, o los míos',
    example: 'jdf list AUTH-100\n                    jdf list --mine --status "In Progress"\n                    jdf list --jql "sprint in openSprints()"',
  },
  {
    cmd: 'move [CLAVE] <estado>',
    description: 'Mover un issue a un nuevo estado',
    example: 'jdf move AUTH-123 "In Review"',
  },
  {
    cmd: 'start [CLAVE]',
    description: 'Mover un issue a "In Progress" (atajo rápido)',
    example: 'jdf start AUTH-123',
  },
  {
    cmd: 'reparent <CLAVE> <NUEVO_PADRE>',
    description: 'Cambiar el issue padre',
    example: 'jdf reparent AUTH-123 AUTH-100',
  },
  {
    cmd: 'open [CLAVE]',
    description: 'Abrir el issue en el navegador',
    example: 'jdf open AUTH-123',
  },
  {
    cmd: 'use <CLAVE>',
    description: 'Entrar a un issue y establecerlo como contexto actual',
    example: 'jdf use PM-100  →  luego jdf list muestra sus hijos',
  },
  {
    cmd: 'up',
    description: 'Subir un nivel (al padre del contexto actual, o a las Épicas)',
    example: 'jdf up',
  },
  {
    cmd: 'where',
    description: 'Mostrar proyecto, directorio y contexto actual',
    example: 'jdf where',
  },
  {
    cmd: 'help',
    description: 'Mostrar esta ayuda',
    example: 'jdf help',
  },
];

const OPTIONS: Array<{ flag: string; description: string; commands: string }> = [
  { flag: '--due <fecha>',        description: 'Fecha de vencimiento (YYYY-MM-DD)',     commands: 'do, edit' },
  { flag: '--parent <CLAVE>',     description: 'Issue padre al crear una tarea',        commands: 'do' },
  { flag: '--type <tipo>',        description: 'Tipo de issue (Tarea, Bug, Historia…)', commands: 'do' },
  { flag: '--assign <accountId>', description: 'ID de cuenta del asignado',            commands: 'do, edit' },
  { flag: '--estimate <tiempo>',  description: 'Estimación: 1h, 30m, 1h30m',           commands: 'edit' },
  { flag: '--status <estado>',    description: 'Nuevo estado del issue',               commands: 'edit, move' },
  { flag: '--mine',               description: 'Solo mis issues',                      commands: 'list' },
  { flag: '--jql <query>',        description: 'Query JQL personalizado',              commands: 'list' },
  { flag: '--no-browser',         description: 'Solo imprimir URL, no abrir navegador', commands: 'open' },
];

export function helpCommand(): void {
  const w = process.stdout.columns ?? 100;
  const line = chalk.dim('─'.repeat(Math.min(w, 80)));

  console.log();
  console.log(chalk.bold.cyan('  DevFlow') + chalk.dim(' — CLI de Jira para desarrolladores'));
  console.log(line);

  console.log(chalk.bold('\n  COMANDOS\n'));

  for (const entry of COMMANDS) {
    console.log(`  ${chalk.cyan(entry.cmd.padEnd(32))} ${entry.description}`);
    if (entry.example) {
      for (const line of entry.example.split('\n')) {
        console.log(`  ${' '.repeat(32)} ${chalk.dim('ej:')} ${chalk.gray(line.trim())}`);
      }
    }
    console.log();
  }

  console.log(line);
  console.log(chalk.bold('\n  OPCIONES COMUNES\n'));

  for (const opt of OPTIONS) {
    console.log(`  ${chalk.yellow(opt.flag.padEnd(26))} ${opt.description} ${chalk.dim(`(${opt.commands})`)}`);
  }

  console.log(line);
  console.log(chalk.bold('\n  RESOLUCIÓN DE CONTEXTO\n'));
  console.log(`  Cuando no pasas una clave de issue, ${chalk.cyan('jdf')} la busca en este orden:`);
  console.log(`  ${chalk.dim('1.')} Argumento directo     ${chalk.gray('jdf get AUTH-123')}`);
  console.log(`  ${chalk.dim('2.')} Contexto guardado     ${chalk.gray('jdf use AUTH-123  →  jdf get')}`);
  console.log(`  ${chalk.dim('3.')} Nombre del branch     ${chalk.gray('git checkout feature/AUTH-123  →  jdf get')}`);
  console.log();

  console.log(line);
  console.log(chalk.bold('\n  FORMATOS DE TIEMPO\n'));
  console.log(`  ${chalk.yellow('1h')}      → 1 hora`);
  console.log(`  ${chalk.yellow('30m')}     → 30 minutos`);
  console.log(`  ${chalk.yellow('1h30m')}   → 1 hora y 30 minutos`);
  console.log();
}
