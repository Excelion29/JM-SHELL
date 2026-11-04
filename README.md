# JM-SHELL (jm) — Jira CLI for Developers

**JM-SHELL** es una herramienta de línea de comandos (CLI) diseñada para agilizar el flujo de trabajo de los desarrolladores que utilizan Jira. Permite gestionar tareas, estados y configuraciones directamente desde la terminal o mediante una terminal integrada personalizada en VS Code.

## 🚀 Instalación

### Requisitos Previos
- [Node.js](https://nodejs.org/) (Versión LTS recomendada)

### Opción 1: Instalador Automático (Usuarios)
Si solo quieres usar la herramienta, utiliza el script de configuración de PowerShell:
1. Localiza el archivo `JM-SHELL-Setup.ps1`.
2. Haz clic derecho y selecciona **"Ejecutar con PowerShell"**.
3. Sigue las instrucciones en pantalla. El instalador configurará automáticamente el comando `jm` globalmente y añadirá un perfil de terminal a tu VS Code.

### Opción 2: Instalación Manual / Desarrollo
Si eres desarrollador y quieres modificar el código o instalarlo manualmente:
```powershell
# 1. Instalar dependencias
npm install

# 2. Compilar y vincular el comando 'jm' globalmente
npm run link
```

## ⚙️ Configuración Inicial

Una vez instalado, debes vincular tu cuenta de Jira:
```powershell
jm init
```
Necesitarás:
- **URL de Jira**: Ejemplo `https://tu-empresa.atlassian.net`
- **Email**: Tu correo asociado a Jira.
- **API Token**: Consíguelo en [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

## 🛠️ Comandos Principales

| Comando | Descripción |
| :--- | :--- |
| `jm init` | Inicia el asistente de configuración. |
| `jm shell` | Abre la shell interactiva de JM-SHELL. |
| `jm --help` | Muestra la lista completa de comandos disponibles. |

## 💻 Integración con VS Code

El instalador crea un perfil de terminal llamado **"JM-SHELL (jm)"**. Para usarlo:
1. Abre una nueva terminal en VS Code (`Ctrl + Shift + \``).
2. En el desplegable de perfiles de terminal, selecciona **JM-SHELL (jm)**.
3. Esto abrirá una terminal que lanza automáticamente el entorno de trabajo de Jira.

## 📦 Construcción del Instalador (Solo Desarrolladores)

Para generar una nueva versión del archivo `JM-SHELL-Setup.ps1` con el código actualizado:
```powershell
npm run installer
```
Esto empaquetará el proyecto actual, lo convertirá a Base64 y lo inyectará en el script de PowerShell para su distribución.
