import inquirer from 'inquirer';
import { saveGlobalConfig, saveProjectConfig, globalConfigExists } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { success, error, info } from '../utils/format';

export async function initCommand(): Promise<void> {
  console.log('\n  DevFlow — Configuración inicial\n');

  const alreadyConfigured = await globalConfigExists();

  let pin: string;
  let existingUrl = '';
  let existingEmail = '';

  if (alreadyConfigured) {
    info('Ya existe una configuración. Verifica tu PIN para continuar.');
    const auth = await requireAuth();
    existingUrl = auth.jiraUrl;
    existingEmail = auth.email;

    const { newPin } = await inquirer.prompt([
      {
        type: 'password',
        name: 'newPin',
        message: 'Nuevo PIN (Enter para mantener el actual, mínimo 4 caracteres):',
        mask: '*',
      },
    ]);
    pin = newPin.length >= 4 ? newPin : '';

    if (!pin) {
      // Mantener el PIN actual — volver a pedirlo
      const { currentPin } = await inquirer.prompt([
        {
          type: 'password',
          name: 'currentPin',
          message: 'Confirma tu PIN actual:',
          mask: '*',
        },
      ]);
      pin = currentPin;
    }
  } else {
    const { newPin, confirmPin } = await inquirer.prompt([
      {
        type: 'password',
        name: 'newPin',
        message: 'Crea un PIN de acceso (mínimo 4 caracteres):',
        mask: '*',
        validate: (val: string) => val.length >= 4 ? true : 'Mínimo 4 caracteres',
      },
      {
        type: 'password',
        name: 'confirmPin',
        message: 'Confirma el PIN:',
        mask: '*',
      },
    ]);
    if (newPin !== confirmPin) {
      error('Los PINs no coinciden. Ejecuta jdf init nuevamente.');
      process.exit(1);
    }
    pin = newPin;
  }

  const globalAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'jiraUrl',
      message: 'URL de Jira (ej: https://empresa.atlassian.net):',
      default: existingUrl,
      validate: (val: string) => val.startsWith('https://') ? true : 'Debe comenzar con https://',
    },
    {
      type: 'input',
      name: 'email',
      message: 'Tu email de Jira:',
      default: existingEmail,
      validate: (val: string) => val.includes('@') ? true : 'Ingresa un email válido',
    },
    {
      type: 'password',
      name: 'apiToken',
      message: 'Tu API token de Jira (https://id.atlassian.com/manage-profile/security/api-tokens):',
      mask: '*',
      validate: (val: string) => val.length > 0 ? true : 'El API token es requerido',
    },
  ]);

  const config = {
    jiraUrl: globalAnswers.jiraUrl.replace(/\/$/, ''),
    email: globalAnswers.email,
    apiToken: globalAnswers.apiToken,
  };

  info('Validando credenciales...');
  const jira = new JiraService(config);

  let user;
  try {
    user = await jira.getMyself();
  } catch (err: unknown) {
    error(`Autenticación fallida: ${(err as Error).message}`);
    process.exit(1);
  }

  await saveGlobalConfig(config, pin);
  success(`Autenticado como ${user.displayName} (${user.emailAddress})`);
  success('Credenciales guardadas y cifradas con tu PIN.');

  // Seleccionar proyecto
  console.log('\n  Configuración del proyecto\n');
  info('Cargando proyectos disponibles...');

  let projects: Array<{ key: string; name: string; projectTypeKey: string }> = [];
  try {
    projects = await jira.getProjects();
  } catch (err: unknown) {
    error(`No se pudieron cargar los proyectos: ${(err as Error).message}`);
    process.exit(1);
  }

  if (projects.length === 0) {
    error('No se encontraron proyectos. Verifica tus permisos en Jira.');
    process.exit(1);
  }

  const projectAnswers = await inquirer.prompt([
    {
      type: 'list',
      name: 'projectKey',
      message: 'Selecciona el proyecto:',
      choices: projects.map((p) => ({
        name: `${p.key.padEnd(12)} ${p.name}`,
        value: p.key,
        short: p.key,
      })),
      pageSize: 15,
    },
    {
      type: 'input',
      name: 'defaultAssignee',
      message: 'ID de cuenta del asignado por defecto (Enter para usar tu cuenta):',
      default: user.accountId,
    },
  ]);

  await saveProjectConfig({
    projectKey: projectAnswers.projectKey,
    defaultAssignee: projectAnswers.defaultAssignee || user.accountId,
  });

  success(`.jira.json creado en el directorio actual`);
  success(`Configuración global guardada en ~/.jira-tool/config.json`);
  console.log('\n  ¡Listo! Prueba: jdf do "Arreglar bug de login" 1h\n');
}
