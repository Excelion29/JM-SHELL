# Spec 001 — Refinamiento asistido y app de terminal (Fase 1)

**Estado:** aprobado — en implementación por partes
**Autor:** Marcello Cano · **Fecha:** 2026-11-04

## Objetivo

Usar DevFlow (`jdf`) desde el análisis de una historia, no solo para registrar tareas: debatir la historia con Claude Code
(suscripción, sin API), sacar tareas con estimación, revisarlas en una pantalla de terminal moderna y crearlas en Jira,
sin perder el hilo si se cierra la consola.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| IA | Claude Code por terminal (`claude`), lanzado por `jdf`. Sin API, sin costo extra. `jdf` nunca pasa credenciales a Claude. |
| Quién debate | El dev (el mismo usuario), con la skill `/refinar`. |
| Duración del debate | 2-3 preguntas por bloque (alcance, dependencias, riesgos, criterio de terminado). Atajo "ya, propón". |
| Criterio de terminado | Se deriva de la HU + el código real del repo (tests, patrones, CLAUDE.md) + preguntas al dev. Nunca inventado. |
| Estimación | PERT 3 puntos: E = (O + 4M + P) / 6, σ = (P − O) / 6. Pregunta ancla ("¿algo parecido antes?"). Partir tareas > 1 día. Minutos permitidos. |
| Dónde se crean | Subtareas de la historia. Sin historia (o ya cerrada) → se pregunta al dev el padre. |
| Interfaz | App única de terminal con Ink (isla ESM en `src/tui/*.mts`). Windows, Linux, macOS. Comandos clásicos siguen funcionando. |
| Persistencia | `.jdf/` en el repo del proyecto, versionado. `.jdf/**/adjuntos/` en `.gitignore`. |
| Adjuntos | Temporales y con propósito: `analisis` (solo para el debate) o `evidencia` / `equipo` (se suben a la subtarea). Al cerrar la historia se eliminan del repo, previa confirmación; lo subido queda en Jira. |
| Tono | Cercano y humano, en español, sin emojis. Ni seco ni adornado: frases cortas, reconoce el avance, varía las frases, siempre cierra con el siguiente paso. |
| Nombre (2026-11-04) | El producto pasa a llamarse **JM-SHELL** y el comando `jm` (sin alias `jdf`). Carpeta de estado `.jm/`. `~/.jira-tool/` no cambia para no perder credenciales ya guardadas. |

## Alcance Fase 1

1. **App base:** marco con identidad, pantalla de PIN, inicio "Donde te quedaste" (historias por fase + siguiente paso).
2. **Modelo de estado SDD por historia** en `.jdf/historias/<KEY>/`:
   - `historia.md` (spec, snapshot de Jira), `bitacora.md` (decisiones por bloque), `plan.json` (tareas),
     `estado.json` (fase, bloque, sesión de Claude, issues creados, adjuntos subidos), `adjuntos/`.
   - Fases: `spec → debate → plan → revisado → creada → en-curso → cerrada`.
   - `.jdf/INICIO.md` regenerado como tablero legible.
3. **Refinar:** descarga la HU y sus adjuntos; lanza `claude --session-id <uuid> "/refinar <KEY>"`, o
   `claude --resume <uuid>` si la historia ya tenía sesión; si la sesión no existe, Claude retoma leyendo `bitacora.md`.
4. **Skill `/refinar`** (`assets/skills/refinar/SKILL.md`, copiada a `~/.claude/skills/` en el postinstall):
   escribe la bitácora al cerrar cada bloque; produce `plan.json`; no toca Jira ni credenciales.
5. **Revisión del plan:** marcar/desmarcar, editar título y O/M/P con recálculo en vivo, ver criterio y porqué,
   asignar adjuntos por tarea con su propósito, abrir un adjunto en el visor del sistema.
6. **Crear en Jira:** solo las tareas marcadas, con descripción (criterio de terminado en ADF), estimación y adjuntos.
   Idempotente: lo ya creado o subido no se repite.
7. **Cerrar historia:** confirma y elimina los adjuntos locales (solo los verificados en Jira, más los de análisis).

## Fuera de alcance

- Fase 2: `list` / `get` / `move` / `edit` / `use` como pantallas de la app.
- Fase 3: calibración (estimado vs. tiempo real registrado en Jira).
- Vista previa de imágenes dentro de la terminal.

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/tui/app.mts`, `src/tui/screens/*.mts`, `src/tui/components/*.mts` | App Ink: PIN, inicio, revisión del plan, creación, cierre. |
| `src/commands/refine.ts` | `jdf refinar [issueKey]`: prepara la carpeta, descarga, lanza o retoma Claude, abre la revisión. |
| `src/commands/import.ts` | `jdf import <plan.json>`: creación idempotente (también usada por la app). |
| `src/refinement/state.ts`, `src/refinement/plan.ts`, `src/refinement/pert.ts` | Estado y fases, validación del plan, cálculo PERT. |
| `src/services/jira.ts` | `createIssue` con `description`; `getAttachments`, `downloadAttachment`, `uploadAttachment`. |
| `src/utils/adf.ts` | `markdownToAdf` (párrafos, listas). |
| `src/config/types.ts` | `RefinementPlan`, `PlannedTask`, `RefinementState`, `Attachment`. |
| `assets/skills/refinar/SKILL.md` | Skill del debate (incluida en `files` del paquete). |
| `src/scripts/postinstall.ts` | Copia la skill a `~/.claude/skills/refinar/`. |
| `src/cli/program.ts`, `src/commands/help.ts`, `src/commands/shell.ts` | Registrar comandos; `jdf` sin argumentos abre la app. |
| `tsconfig.json`, `package.json` | `module: node16`; dependencias `ink`, `react`, `ink-text-input`; script de tests. |

## Criterios de aceptación

- **CA1** Dado una historia sin refinar, cuando ejecuto `jdf refinar AQ-45`, entonces se crea `.jdf/historias/AQ-45/` con
  `historia.md` y los adjuntos de la HU, y se abre Claude con `/refinar AQ-45`.
- **CA2** Dado un debate a medias y la consola cerrada, cuando vuelvo a abrir `jdf`, entonces el inicio muestra AQ-45 en
  fase `debate` con su último bloque, y al continuar se retoma la sesión o se reconstruye desde `bitacora.md`.
- **CA3** Dado un `plan.json`, cuando edito O/M/P de una tarea en la revisión, entonces el esperado y el total se recalculan
  y el cambio queda guardado en `plan.json`.
- **CA4** Dado que la creación falló en la tarea 3 de 5, cuando reintento, entonces solo se crean las tareas 3-5 y no hay
  duplicados en Jira.
- **CA5** Dado un adjunto marcado `evidencia` en una tarea, cuando se crea la tarea, entonces el archivo queda adjunto en su
  issue y se registra como subido en `estado.json`.
- **CA6** Dado que cierro la historia, cuando confirmo, entonces se eliminan de `adjuntos/` solo los archivos verificados
  en Jira y los de `analisis`; si no confirmo, no se elimina nada.
- **CA7** Dado una historia sin padre válido, cuando creo las tareas, entonces la app me pide dónde crearlas.
- **CA8** Los comandos clásicos existentes (`do`, `bulk`, `list`, `move`, etc.) siguen funcionando igual.

## Tests

Unitarios: cálculo PERT, validación de `plan.json`, transiciones de fase, idempotencia de la creación (Jira simulado),
`markdownToAdf`. Manual: un recorrido completo contra una historia de prueba en el proyecto `AQ`.

## Riesgos

- Ink + ESM dentro de un CLI en CommonJS: mitigado con la isla `.mts` y `import()` dinámico; se valida primero.
- Límite de tamaño de adjuntos del sitio Jira: tope configurable antes de subir.
- La terminal clásica de Windows (conhost) muestra menos colores; se recomienda Windows Terminal.

## Aprobación

| Gate | Quién | Fecha | Estado |
|---|---|---|---|
| Accept (plan) | Marcello Cano | 2026-11-04 | aprobado ("dale") |
| Commit parte 1 (base app) | Marcello Cano | 2026-11-04 | aprobado, probado en terminal real |
| Commit parte 2 (estado SDD + refinar) | Marcello Cano | 2026-11-04 | aprobado; flujo real con Jira y Claude pendiente de prueba |
