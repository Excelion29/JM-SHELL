import chalk from 'chalk';

const C = {
  title:   (s: string) => chalk.bold.cyan(s),
  cmd:     (s: string) => chalk.cyan(s),
  arg:     (s: string) => chalk.yellow(s),
  opt:     (s: string) => chalk.yellow(s),
  dim:     (s: string) => chalk.dim(s),
  url:     (s: string) => chalk.underline.blue(s),
  section: (s: string) => chalk.bold.white(s),
  good:    (s: string) => chalk.green(s),
  tag:     (s: string) => chalk.dim(`(${s})`),
};

interface Section {
  title: string;
  commands: CommandDoc[];
}

interface CommandDoc {
  cmd: string;
  args?: string;
  description: string;
  detail?: string[];
  options?: Array<{ flag: string; description: string }>;
  examples: string[];
}

const SECTIONS: Section[] = [
  {
    title: '⚙  CONFIGURACIÓN',
    commands: [
      {
        cmd: 'init',
        description: 'Configura credenciales, PIN de acceso y proyecto Jira.',
        detail: [
          'Primera vez: pide URL de Jira, email, API token y crea un PIN.',
          'Si ya existe config, verifica el PIN antes de permitir cambios.',
          'Crea ~/.jira-tool/config.json (cifrado con PIN) y .jira.json en el directorio actual.',
        ],
        examples: [
          'jdf init',
        ],
      },
      {
        cmd: 'projects',
        description: 'Lista todos los proyectos Jira a los que tienes acceso.',
        examples: [
          'jdf projects',
        ],
      },
      {
        cmd: 'shell',
        description: 'Inicia una sesión interactiva: el PIN se pide una sola vez.',
        detail: [
          'Dentro del shell escribe los comandos sin el prefijo "jdf".',
          'Cierra la sesión con: exit, salir, quit o Ctrl+C.',
        ],
        examples: [
          'jdf shell',
          '  jdf> list',
          '  jdf> use PM-100',
          '  jdf> bulk',
          '  jdf> exit',
        ],
      },
    ],
  },
  {
    title: '🗂  NAVEGACIÓN Y CONTEXTO',
    commands: [
      {
        cmd: 'use',
        args: '<CLAVE>',
        description: 'Entra a un issue y lo establece como contexto activo.',
        detail: [
          'El contexto afecta a list, do, bulk, edit, get, start, move y open.',
          'Se guarda en .jira-context.json del directorio del proyecto.',
        ],
        examples: [
          'jdf use PM-100',
        ],
      },
      {
        cmd: 'up',
        description: 'Sube un nivel en la jerarquía.',
        detail: [
          'Desde una Historia/Tarea/Bug → sube a la Épica padre.',
          'Desde una Épica → vuelve al nivel raíz (limpia el contexto).',
          'Desde una Subtarea → sube a la Historia/Tarea padre.',
        ],
        examples: [
          'jdf up',
        ],
      },
      {
        cmd: 'where',
        description: 'Muestra en qué proyecto, directorio y contexto estás.',
        examples: [
          'jdf where',
        ],
      },
      {
        cmd: 'types',
        description: 'Muestra qué tipos de issue puedes crear según tu ubicación.',
        detail: [
          'Raíz / sin contexto → Épica, Historia, Bug, Tarea…',
          'Dentro de Épica     → Historia, Bug, Tarea… (sin Épica)',
          'Dentro de Historia  → solo Subtareas',
          'Dentro de Subtarea  → no se puede crear (muestra aviso)',
        ],
        examples: [
          'jdf types',
        ],
      },
    ],
  },
  {
    title: '📋  LISTAR ISSUES',
    commands: [
      {
        cmd: 'list',
        args: '[PADRE]',
        description: 'Lista issues según tu ubicación en la jerarquía.',
        detail: [
          'Sin contexto         → muestra las Épicas del proyecto.',
          'Con contexto activo  → muestra los hijos del issue actual.',
          'Con PADRE explícito  → muestra los hijos de ese issue.',
          'Agrupa los resultados por tipo de issue.',
        ],
        options: [
          { flag: '--mine',           description: 'Solo issues asignados a ti' },
          { flag: '--status <estado>', description: 'Filtra por estado' },
          { flag: '--jql <query>',    description: 'Query JQL personalizado (ignora el contexto)' },
        ],
        examples: [
          'jdf list                          # épicas o hijos del contexto',
          'jdf list PM-100                   # hijos de PM-100',
          'jdf list --mine',
          'jdf list --mine --status "En curso"',
          'jdf list --jql "sprint in openSprints() AND assignee = currentUser()"',
        ],
      },
    ],
  },
  {
    title: '✏  CREAR ISSUES',
    commands: [
      {
        cmd: 'do',
        args: '<título> [tiempo]',
        description: 'Crea una tarea, la asigna y la mueve a "In Progress".',
        detail: [
          'Si hay contexto activo, el nuevo issue se crea como hijo automáticamente.',
          'Pregunta el tipo de issue según el nivel jerárquico actual.',
          'El tiempo puede ir como argumento o con --estimate.',
        ],
        options: [
          { flag: '--estimate <tiempo>', description: 'Estimación: 1h, 30m, 1h30m' },
          { flag: '--due <fecha>',       description: 'Fecha de vencimiento YYYY-MM-DD (default: hoy)' },
          { flag: '--parent <CLAVE>',    description: 'Issue padre (override del contexto)' },
          { flag: '--assign <id>',       description: 'Account ID del asignado' },
          { flag: '--type <tipo>',       description: 'Tipo explícito: Tarea, Bug, Historia…' },
        ],
        examples: [
          'jdf do "Fix bug de login" 1h',
          'jdf do "Revisar PR" --estimate 30m',
          'jdf do "Nueva feature" 2h --due 2026-05-01 --type Historia',
          'jdf do "Subtarea rápida" 1h --parent PM-100',
        ],
      },
      {
        cmd: 'bulk',
        description: 'Crea múltiples issues de una vez en estado "Por hacer".',
        detail: [
          'Si hay contexto activo, todos los issues se crean como hijos.',
          'Pregunta el tipo una sola vez para todas las tareas.',
          'Por cada tarea pide: título (requerido), asignado, fecha y estimación.',
          'Deja el título vacío para terminar y ver el resumen.',
        ],
        examples: [
          'jdf bulk',
        ],
      },
    ],
  },
  {
    title: '🔧  MODIFICAR ISSUES',
    commands: [
      {
        cmd: 'edit',
        args: '[CLAVE]',
        description: 'Edita campos de un issue.',
        detail: [
          'Sin CLAVE usa el contexto activo o el branch de git.',
        ],
        options: [
          { flag: '--title <texto>',    description: 'Nuevo título' },
          { flag: '--estimate <tiempo>',description: 'Estimación: 1h, 30m, 1h30m' },
          { flag: '--due <fecha>',      description: 'Fecha de vencimiento YYYY-MM-DD' },
          { flag: '--assign <id>',      description: 'Account ID del asignado' },
          { flag: '--status <estado>',  description: 'Nuevo estado (si no existe, muestra lista)' },
        ],
        examples: [
          'jdf edit --status "In Review"',
          'jdf edit PM-100 --title "Nuevo título" --due 2026-05-01',
          'jdf edit PM-100 --estimate 2h --assign abc123',
        ],
      },
      {
        cmd: 'move',
        args: '[CLAVE] <estado>',
        description: 'Mueve un issue a un nuevo estado.',
        detail: [
          'Acepta match parcial e insensible a mayúsculas.',
          'Si el estado no existe, muestra una lista para elegir.',
        ],
        examples: [
          'jdf move "In Review"',
          'jdf move PM-100 Done',
        ],
      },
      {
        cmd: 'start',
        args: '[CLAVE]',
        description: 'Mueve un issue a "In Progress" (atajo rápido).',
        examples: [
          'jdf start',
          'jdf start PM-100',
        ],
      },
      {
        cmd: 'reparent',
        args: '<CLAVE> <NUEVO_PADRE>',
        description: 'Cambia el issue padre.',
        examples: [
          'jdf reparent PM-110 PM-100',
        ],
      },
    ],
  },
  {
    title: '🔍  VER ISSUES',
    commands: [
      {
        cmd: 'get',
        args: '[CLAVE]',
        description: 'Muestra los detalles completos de un issue.',
        detail: [
          'Sin CLAVE usa el contexto activo o el branch de git.',
        ],
        examples: [
          'jdf get',
          'jdf get PM-100',
        ],
      },
      {
        cmd: 'open',
        args: '[CLAVE]',
        description: 'Abre el issue en el navegador e imprime la URL.',
        options: [
          { flag: '--no-browser', description: 'Solo imprime la URL, no abre el navegador' },
        ],
        examples: [
          'jdf open',
          'jdf open PM-100',
          'jdf open PM-100 --no-browser',
        ],
      },
    ],
  },
];

const TIME_FORMATS = ['1h', '30m', '1h30m', '2h15m'];

const CONTEXT_RESOLUTION = [
  { step: '1', label: 'Argumento directo',  example: 'jdf get PM-100' },
  { step: '2', label: 'Contexto (jdf use)', example: 'jdf use PM-100  →  jdf get' },
  { step: '3', label: 'Branch de git',      example: 'git checkout feature/PM-100  →  jdf get' },
];

export function helpCommand(): void {
  const lineWidth = Math.min(process.stdout.columns ?? 100, 90);
  const hr = chalk.dim('─'.repeat(lineWidth));

  console.log();
  console.log(C.title('  DevFlow (jdf)') + C.dim(' — CLI de Jira para desarrolladores'));
  console.log(hr);

  for (const section of SECTIONS) {
    console.log(C.section(`\n  ${section.title}\n`));

    for (const doc of section.commands) {
      // Cabecera del comando
      const cmdLine = [
        C.cmd(`jdf ${doc.cmd}`),
        doc.args ? C.arg(doc.args) : '',
      ].filter(Boolean).join(' ');

      console.log(`  ${cmdLine}`);
      console.log(`  ${chalk.dim('→')} ${doc.description}`);

      // Detalles
      if (doc.detail) {
        for (const line of doc.detail) {
          console.log(`    ${C.dim('·')} ${line}`);
        }
      }

      // Opciones
      if (doc.options && doc.options.length > 0) {
        console.log(`    ${C.dim('Opciones:')}`);
        for (const opt of doc.options) {
          console.log(`      ${C.opt(opt.flag.padEnd(22))} ${opt.description}`);
        }
      }

      // Ejemplos
      console.log(`    ${C.dim('Ejemplos:')}`);
      for (const ex of doc.examples) {
        const isIndented = ex.startsWith('  ');
        console.log(`      ${C.dim(isIndented ? ex : `$ ${ex}`)}`);
      }

      console.log();
    }

    console.log(hr);
  }

  // Resolución de contexto
  console.log(C.section('\n  RESOLUCIÓN DE CONTEXTO\n'));
  console.log('  Cuando no pasas CLAVE, el CLI la resuelve en este orden:\n');
  for (const r of CONTEXT_RESOLUTION) {
    console.log(`  ${C.dim(r.step + '.')} ${r.label.padEnd(24)} ${C.dim(r.example)}`);
  }
  console.log();
  console.log(hr);

  // Formatos de tiempo
  console.log(C.section('\n  FORMATOS DE TIEMPO\n'));
  for (const fmt of TIME_FORMATS) {
    console.log(`  ${C.arg(fmt.padEnd(10))} ${C.dim('→')} ${describeTime(fmt)}`);
  }
  console.log();
}

function describeTime(fmt: string): string {
  const h = fmt.match(/(\d+)h/)?.[1];
  const m = fmt.match(/(\d+)m/)?.[1];
  const parts = [];
  if (h) parts.push(`${h} hora${parseInt(h) > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} minutos`);
  return parts.join(' y ');
}
