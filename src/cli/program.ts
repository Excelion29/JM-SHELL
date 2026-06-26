import { Command } from 'commander';
import { initCommand } from '../commands/init';
import { doCommand } from '../commands/do';
import { getCommand } from '../commands/get';
import { editCommand } from '../commands/edit';
import { listCommand } from '../commands/list';
import { moveCommand } from '../commands/move';
import { startCommand } from '../commands/start';
import { reparentCommand } from '../commands/reparent';
import { openCommand } from '../commands/open';
import { useCommand } from '../commands/use';
import { whereCommand } from '../commands/where';
import { projectsCommand } from '../commands/projects';
import { helpCommand } from '../commands/help';
import { upCommand } from '../commands/up';
import { bulkCommand } from '../commands/bulk';
import { typesCommand } from '../commands/types';
import { movesCommand } from '../commands/moves';
import { exportCommand } from '../commands/export';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('jdf')
    .description('DevFlow — CLI de Jira para desarrolladores')
    .version('1.0.0')
    .helpOption('-h, --help', 'Mostrar ayuda')
    // Evitar que commander llame a process.exit en errores dentro del shell
    .exitOverride();

  program.command('help', { isDefault: false })
    .description('Mostrar ayuda detallada con todos los comandos y ejemplos')
    .action(helpCommand);

  program.command('init')
    .description('Configurar credenciales y proyecto de Jira')
    .action(initCommand);

  program.command('projects')
    .description('Listar todos los proyectos disponibles en Jira')
    .action(projectsCommand);

  program.command('do <summary> [time]')
    .description('Crear una tarea y moverla a In Progress')
    .option('--due <fecha>', 'Fecha de vencimiento (YYYY-MM-DD), por defecto hoy')
    .option('--estimate <tiempo>', 'Estimación de tiempo (1h, 30m, 1h30m)')
    .option('--parent <clave>', 'Clave del issue padre')
    .option('--assign <accountId>', 'ID de cuenta del asignado')
    .option('--type <tipo>', 'Tipo de issue (Tarea, Historia, Bug…)')
    .action(doCommand);

  program.command('get [issueKey]')
    .description('Mostrar detalles de un issue')
    .action(getCommand);

  program.command('edit [issueKey]')
    .description('Editar campos de un issue')
    .option('--title <texto>', 'Nuevo título/resumen')
    .option('--estimate <tiempo>', 'Estimación de tiempo (ej: 1h, 30m, 1h30m)')
    .option('--due <fecha>', 'Fecha de vencimiento (YYYY-MM-DD)')
    .option('--assign <accountId>', 'ID de cuenta del asignado')
    .option('--status <estado>', 'Nuevo estado (activa transición)')
    .action(editCommand);

  program.command('list [parentKey]')
    .description('Listar issues jerárquicamente')
    .option('--mine', 'Solo mostrar issues asignados a mí')
    .option('--status <estado>', 'Filtrar por estado')
    .option('--jql <query>', 'Query JQL directo')
    .action(listCommand);

  program.command('move [issueKey] <status>')
    .description('Mover un issue a un nuevo estado')
    .action(moveCommand);

  program.command('start [issueKey]')
    .description('Mover un issue a "In Progress"')
    .action(startCommand);

  program.command('reparent <issueKey> <newParentKey>')
    .description('Cambiar el padre de un issue')
    .action(reparentCommand);

  program.command('open [issueKey]')
    .description('Abrir un issue en el navegador')
    .option('--no-browser', 'Solo imprimir la URL, no abrir navegador')
    .action(openCommand);

  program.command('use <issueKey>')
    .description('Entrar a un issue y establecerlo como contexto')
    .action(useCommand);

  program.command('bulk')
    .description('Crear múltiples tareas de una vez (estado inicial: Por hacer)')
    .action(bulkCommand);

  program.command('types')
    .description('Ver qué tipos de issue puedes crear según tu ubicación actual')
    .action(typesCommand);

  program.command('up')
    .description('Subir un nivel en la jerarquía')
    .action(upCommand);

  program.command('where')
    .description('Mostrar proyecto y contexto actual')
    .action(whereCommand);

  program.command('moves [issueKey]')
    .description('Ver estados disponibles para el issue')
    .action(movesCommand);

  program.command('export [epicKey]')
    .description('Exportar épica(s) con todas sus historias y descripciones a markdown')
    .option('--out <ruta>', 'Escribir output a un archivo en lugar de stdout')
    .option('--all', 'Exportar todas las épicas del proyecto')
    .option('--type <tipo>', 'Filtrar por tipo de issue: Historia, Bug, Tarea, etc.')
    .option('--jql <query>', 'JQL directo para búsqueda personalizada')
    .action(exportCommand);

  return program;
}
