# Spec 001 — Refinamiento asistido y app de terminal (Fase 1)

**Estado:** aprobado — en implementación por partes
**Autor:** Marcello Cano · **Fecha:** 2026-11-04

## Objetivo

Usar JM-SHELL (`jm`) desde el análisis de una historia, no solo para registrar tareas: debatir la historia con Claude Code
(suscripción, sin API), sacar tareas con estimación, revisarlas en una pantalla de terminal moderna y crearlas en Jira,
sin perder el hilo si se cierra la consola.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| IA | Claude Code por terminal (`claude`), lanzado por `jm`. Sin API, sin costo extra. `jm` nunca pasa credenciales a Claude. |
| Quién debate | El dev (el mismo usuario), con la skill `/refinar`. |
| Duración del debate | 2-3 preguntas por bloque (alcance, dependencias, riesgos, criterio de terminado). Atajo "ya, propón". |
| Criterio de terminado | Se deriva de la HU + el código real del repo (tests, patrones, CLAUDE.md) + preguntas al dev. Nunca inventado. |
| Estimación | PERT 3 puntos: E = (O + 4M + P) / 6, σ = (P − O) / 6. Pregunta ancla ("¿algo parecido antes?"). Partir tareas > 1 día. Minutos permitidos. |
| Dónde se crean | Subtareas de la historia. Sin historia (o ya cerrada) → se pregunta al dev el padre. |
| Interfaz | App única de terminal con Ink (isla ESM en `src/tui/*.mts`). Windows, Linux, macOS. Comandos clásicos siguen funcionando. |
| Persistencia | `.jm/` en el repo del proyecto, versionado. `.jm/**/adjuntos/` en `.gitignore`. |
| Adjuntos | Temporales y con propósito: `analisis` (solo para el debate) o `evidencia` / `equipo` (se suben a la subtarea). Al cerrar la historia se eliminan del repo, previa confirmación; lo subido queda en Jira. |
| Tono | Cercano y humano, en español, sin emojis. Ni seco ni adornado: frases cortas, reconoce el avance, varía las frases, siempre cierra con el siguiente paso. |
| Nombre (2026-11-04) | El producto pasa a llamarse **JM-SHELL** y el comando `jm` (sin alias `jdf`). Carpeta de estado `.jm/`. `~/.jira-tool/` no cambia para no perder credenciales ya guardadas. |

## Alcance Fase 1

1. **App base:** marco con identidad, pantalla de PIN, inicio "Donde te quedaste" (historias por fase + siguiente paso).
2. **Modelo de estado SDD por historia** en `.jm/historias/<KEY>/`:
   - `historia.md` (spec, snapshot de Jira), `bitacora.md` (decisiones por bloque), `plan.json` (tareas),
     `estado.json` (fase, bloque, sesión de Claude, issues creados, adjuntos subidos), `adjuntos/`.
   - Fases: `spec → debate → plan → revisado → creada → en-curso → cerrada`.
   - `.jm/INICIO.md` regenerado como tablero legible.
3. **Refinar:** descarga la HU y sus adjuntos; lanza `claude --session-id <uuid> "/refinar <KEY>"`, o
   `claude --resume <uuid>` si la historia ya tenía sesión; si la sesión no existe, Claude retoma leyendo `bitacora.md`.
4. **Skill `/refinar`** (`assets/skills/refinar/SKILL.md`, copiada a `~/.claude/skills/` en el postinstall):
   escribe la bitácora al cerrar cada bloque; produce `plan.json`; no toca Jira ni credenciales.
5. **Revisión del plan:** marcar/desmarcar, editar título y O/M/P con recálculo en vivo, ver criterio y porqué,
   asignar adjuntos por tarea con su propósito, abrir un adjunto en el visor del sistema.
6. **Crear en Jira:** solo las tareas marcadas, con descripción (criterio de terminado en ADF), estimación y adjuntos.
   Idempotente: lo ya creado o subido no se repite.
7. **Cerrar historia:** confirma y elimina los adjuntos locales (solo los verificados en Jira, más los de análisis).

### Parte 2.5 — Explorar Jira desde la app (agregada 2026-11-04)

Pedido del dev al probar: `n` solo pedía escribir la clave. Ahora:

- `n` → épicas del proyecto (incluye "Historias sin épica") → historias de la épica → Enter = refinar. Filtro escribiendo; `k` para escribir la clave; Esc vuelve.
- `p` → cambiar de proyecto: actualiza `projectKey` del `.jira.json` del proyecto (confirma antes de pisar uno distinto).
- Al crear `.jm/` se escribe `.jm/.gitignore` con `historias/*/adjuntos/`.

### Parte 2.6 — Debate dentro de la app y reparto de modelos (agregada 2026-11-04)

Pedido del dev: no saltar a la interfaz de Claude y no gastar tokens de más.

- El debate se muestra en una pantalla de `jm`, usando `claude -p` con stream-json (suscripción, sin API key).
  Esc vuelve al inicio con la sesión guardada; `c` abre Claude Code completo como alternativa.
- Permisos de la sesión: solo lectura del código y escritura en `.jm/historias/<KEY>/`.
- Modelos por actividad: conversación en **Sonnet**; subagente "explorador" en **Haiku** (solo lectura, devuelve
  mapa `archivo:línea`); resumen de retoma en Haiku; **Opus** solo a pedido (`o`), retomando la misma sesión.
- Consumo visible por historia (tokens y costo equivalente) guardado en `estado.json`; si la sesión crece de más,
  se propone continuar en sesión nueva desde la bitácora.
- La copia local de la conversación se guarda ignorada por git.
- Bug: al abrir Claude completo, `jm` retenía el teclado en Windows; se suelta stdin antes de lanzar Claude.
- Decisiones aceptadas por el dev (2026-11-04): atajos del chat con Ctrl (Ctrl+O Opus, Ctrl+N sesión nueva,
  Ctrl+T Claude completo, Ctrl+J salto de línea); resumen de retoma con Sonnet; la skill viaja dentro de `jm`
  (`--append-system-prompt-file`) y el chat no carga configuración de usuario ni del proyecto.

### Parte 2.7 — Presentación del chat y carpeta de código por proyecto (agregada 2026-11-04)

Pedido del dev tras probar: el texto salía "de golpe", sin estructura.

- Render de markdown en el chat (negrita, código, listas, bloques), mensajes separados con etiqueta y aire.
- La pregunta pendiente se resalta en un recuadro; si trae opciones numeradas se eligen con 1-9.
- La cabecera muestra el tamaño de contexto actual y el costo (no la suma con lecturas de caché).
- La skill responde un mensaje por turno, con formato fijo (contexto, evidencia, una pregunta) y espera al explorador.
- `jm` recuerda la carpeta de código de cada proyecto de Jira (`~/.jira-tool/repos.json`); la primera vez la pregunta.

### Parte 3 — Revisión del plan, creación en Jira y cierre (inicio 2026-11-04)

Decisiones de implementación:
- La revisión se abre con `r` sobre una historia en fase `plan`/`revisado` (y desde el aviso del chat).
- Estimación en Jira = esperado PERT redondeado a 5 min; O/M/P y riesgo van en la descripción junto al criterio de terminado.
- Responsable por defecto: el del `.jira.json` (o tú); se puede cambiar para todo el plan antes de crear.
- Antes de crear cada tarea se comparan los títulos con las subtareas que ya tiene el padre, además de `estado.json`,
  para no duplicar si la creación se cortó a medias.
- Cerrar historia (`x`): confirma y borra solo adjuntos verificados en Jira (nombre y tamaño) y los de análisis.

### Parte 3.1 — Cada carpeta es independiente y el chat se puede releer (agregada 2026-11-05)

Observación del dev tras probar: al abrir `jm` en otro proyecto con la misma historia, Claude siguió buscando en
JDF-SHELL porque `~/.jira-tool/repos.json` guardaba esa carpeta para PM; además no podía subir a leer el chat.
- `jm` trabaja solo en la carpeta donde se abre (la del `.jira.json` más cercano, o la actual): ahí vive `.jm/` y ahí
  corre Claude. No se comparte nada entre carpetas.
- Se elimina el mapeo global `repos.json`, la carpeta global `sin-codigo/`, la pregunta de carpeta de código y Ctrl+F.
- El chat carga toda la conversación guardada; PgUp/PgDn siempre visibles en la ayuda; ↑↓ desplazan con el campo vacío.

### Parte 3.2 — Base de conocimiento por carpeta (agregada 2026-11-05, después del commit de 3 + 3.1)

Idea del dev: que la continuidad entre carpetas venga de una fuente que él elige, como un RAG extendido.
- La primera vez que se abre una historia en una carpeta, `jm` pregunta si conectar una base de conocimiento:
  **MCP** (host, p. ej. Obsidian Local REST API `https://127.0.0.1:27124/mcp`), **carpeta local** de la PC, o ninguna;
  y la carpeta dentro de la base (p. ej. `PROYECTOS/PACASMAYO_MEZCLAS`). Se guarda en el `.jira.json` de esa carpeta.
- La API key nunca va al `.jira.json`: se guarda en `~/.jira-tool/` como el token de Jira.
- Claude se lanza con esa fuente disponible (MCP o la carpeta local) y la skill lee primero el contexto y las
  convenciones de la carpeta elegida, y consulta el resto cuando lo necesita.
- La carpeta elegida es el foco y punto de partida, no un límite: Claude puede indagar en toda la base (otras
  carpetas, notas relacionadas) cuando el debate lo pida. Por su cuenta Claude solo escribe en la carpeta JM-ADR; fuera de ella
  escribe únicamente cuando el dev se lo indica explícitamente (qué y dónde).
- Decisiones y avances se escriben en la sección `JM-ADR` de esa carpeta: si ya existe una carpeta cuyo nombre
  termina en `JM-ADR` (p. ej. `06-JM-ADR`) se usa; si no, se crea `NN-JM-ADR` con el número siguiente al mayor
  existente, o `00-JM-ADR` si no hay numeración. Una nota por historia (`<KEY>.md`). (Cambio del dev 2026-11-05:
  antes era `Conocimiento`.)
- Se escribe al cerrar cada bloque y al tener el plan, avisando en el chat qué se guardó y dónde.
- Al abrir la historia en otra carpeta conectada a la misma base, se retoma desde esa nota; si no hay nota ni debate
  local, se empieza de cero.

Decisiones del dev sobre el plan técnico (2026-11-05):
- La carpeta base no se escribe a mano: `jm` lista las carpetas de la base y deja navegar (entrar, subir) y ver su
  contenido (archivos y vista previa de notas) para fijar dónde continuar o crear el conocimiento.
- El PIN se guarda en memoria mientras la app está abierta, para cifrar la API key en `~/.jira-tool/`.
- Solo se pregunta por la base cuando la carpeta ya tiene `.jira.json` con proyecto.
- Si la base no responde o la key falla al abrir, el chat avisa y **no** continúa (bloquea) hasta que se resuelva.
- Reconfigurar la base desde la app queda para después de 3.2 (por ahora, editando `.jira.json`).
- MCP siempre a través de un intermediario local de `jm` (decisión 2026-11-05, tras la prueba técnica: el cliente de
  Claude no acepta el certificado propio de Obsidian y apagar TLS no es aceptable). Mientras el chat está abierto, `jm`
  escucha solo en 127.0.0.1 (puerto libre), Claude se conecta ahí sin key, y `jm` reenvía al MCP real verificando TLS
  y agregando la key. El intermediario solo deja pasar las herramientas permitidas: lectura/búsqueda + `vault_write` y
  `vault_append`; bloquea borrar, mover, copiar y ejecutar comandos.
- Certificado: al configurar, `jm` prueba con las autoridades del sistema; si no valida, muestra la huella y pregunta si
  confiar; si sí, guarda el certificado en `~/.jira-tool/` y lo usa para verificar.

### Parte 3.3 — Estimación propia, fecha por tarea y ajustes de la prueba real (agregada 2026-11-05)

Pedido del dev tras usarlo con PM-136:
- **Estimación del dev:** en la revisión, cada tarea muestra la recomendación (esperado PERT) y el dev puede fijar a
  mano su estimación final (p. ej. `3h`). Esa es la que va a Jira como estimación original; si no la fija, va la
  recomendación.
- **Fecha por tarea:** `jm` recomienda fechas desde **hoy** (siempre hoy por defecto), llenando 8 h por día en el orden
  del plan y pasando al día siguiente cuando no cabe; la recomendación salta sábado y domingo. No descuenta tareas que
  el dev ya tenga en Jira. El dev puede editar cualquier fecha (incluido fin de semana) y exceder las 8 h. La tarea se
  crea con esa fecha de vencimiento.
- Las tareas nacen en el estado inicial ("Por hacer"); `jm` no las transiciona al crearlas.
- **Chat:** el campo de escritura muestra como máximo unas líneas con aviso de cuántas más hay (al pegar bloques
  grandes); las tabulaciones se muestran como espacios. Se envía el texto completo.
- **Skill `/refinar`:** tareas por entregable (no por repo ni capa salvo que cambie quién o cuándo), juntar tareas de
  menos de 1 h, sin tareas de "documentar" o "lo ya hecho" salvo pedido; la tabla de tareas trae la estimación
  recomendada (O/M/P, esperado y porqué) y el dev confirma o ajusta en el mismo paso.
- **Estimación con IA** (pedido del dev 2026-11-05): la skill estima el tiempo de hacerlo con Claude Code (pedir,
  revisar, probar, corregir), no a mano; cambio acotado con patrón existente ~15m–45m; ante la duda propone bajo.

### Parte 3.4 — Interfaz pulida (agregada 2026-11-05)

Pedido del dev: las tablas del chat salen como texto crudo y la pantalla se desforma al cambiar el tamaño de la consola.
Se mantiene Ink (misma base que Claude Code); el problema es de uso, no de librería.
1. Pantalla alternativa (como `htop`/`vim`): `jm` ocupa la ventana y al salir la terminal queda como estaba.
2. Redibujo limpio al cambiar el tamaño y marco del alto exacto de la ventana.
3. Tablas Markdown dibujadas con bordes y columnas alineadas; en ventanas angostas, cada fila como ficha.
4. Pulido visual: encabezado y pie fijos, chat con desplazamiento propio, tablas alineadas en revisión y creación.
Orden pedido por el dev: primero una prueba de 1 y 2 en su terminal; si resuelve, el resto de corrido.

### Parte 3.5 — El estado de la historia vive en la base de conocimiento (agregada 2026-11-05)

Pedido del dev: no crear `.jm/` dentro del repositorio cuando hay una base conectada.
- Con base (MCP o carpeta local): historia, bitácora, plan, estado, conversación y adjuntos van a
  `<base>/NN-JM-ADR/<KEY>/` junto a la nota `<KEY>.md`; Claude trabaja con el código del repo pero escribe ahí.
- Archivos técnicos de la sesión (settings de Claude, mcp.json, copia de la skill) van a una carpeta de trabajo de
  `jm` en el usuario (`~/.jira-tool/trabajo/…`), nunca al repo.
- Sin base: `.jm/` en el proyecto como hoy, agregada a `.git/info/exclude` (no toca el `.gitignore` del equipo).
- Lo existente en `.jm/historias/<KEY>` se mueve automáticamente a la base la primera vez que se abre la historia.
- Va antes de la parte 4 (que depende de dónde vive el estado).
- Decisiones del dev (2026-11-05): si la historia ya está en la base y hay `.jm` local, gana la base y lo local se
  renombra como respaldo con aviso; imágenes/PDF: copia oficial en la bóveda y copia de solo lectura en la carpeta de
  trabajo para que Claude las abra; si la bóveda no guarda bien binarios, los adjuntos viven en la carpeta de trabajo.
- Conexiones entre notas: la nota `<KEY>.md` lleva frontmatter (historia, épica, proyecto, fase, tareas, módulos,
  etiquetas) y enlaces `[[...]]`; `jm` mantiene un índice `00-indice.md` en JM-ADR sin pasar por Claude. Graphify no
  entra en `jm`: el entendimiento del código lo aporta el entorno de Claude Code del dev al ejecutar tareas.
- Prueba técnica autorizada contra Obsidian real en `PROYECTOS/PACASMAYO_MEZCLAS/_jm-prueba/` (se crea y se borra).

### Parte 5 — Reconfigurar la base desde la app (agregada 2026-11-06)

Tecla `b` en el inicio: muestra la configuración de la base de esa carpeta (tipo, URL o ruta, carpeta base, JM-ADR) y
permite cambiar la carpeta base (navegador), cambiar la conexión (URL/key MCP con certificado, o carpeta local),
quitar la base (ninguna) y renovar la API key sin tocar lo demás.
- Historias existentes al cambiar: se quedan donde están y `jm` avisa cuántas quedan en la ubicación anterior
  (opción A). Moverlas con la migración verificada (opción B) queda para una actualización posterior.
- Ajustes del dev (2026-11-06): la pantalla de tareas muestra primero lo en curso, luego lo por hacer y al final lo
  finalizado. La descripción de la subtarea en Jira ya no lleva la línea "Estimación … esperado … riesgo": el tiempo
  va solo en el campo de estimación de Jira y el PERT queda en el plan local. `r` también abre la revisión con la
  historia creada o en curso, para crear tareas agregadas después (las que ya tienen clave de Jira no se tocan ni se
  duplican); la skill ya no cambia la fase en ese caso.

### Parte 6 — Calibración estimado vs. real (agregada 2026-11-07)

Todo sin IA ni Jira extra (0 tokens), con lo que `jm` ya guarda por tarea.
- Tiempo real con **dos medidas**: con Claude abierto (la herramienta de trabajo, aunque abierto no siempre es
  trabajando) y de inicio a fin (se puede cerrar Claude sin haber terminado).
- Pantalla de tareas: columna "real" (Claude / inicio a fin) y resumen de las finalizadas medidas contra su estimación.
- Pantalla "Calibración" (tecla `c` en el inicio), historias de esta carpeta: cuántas medidas, real = N × estimado con
  cada medida, lo mismo por riesgo y las 5 tareas más desviadas. Las finalizadas con `f` (sin inicio medido) y las que
  no son del plan quedan fuera.
- No se registra worklog en Jira: al PM le importa la estimación y la fecha; la estimación original no se toca.
- Punto 3 (agregado 2026-11-09): en la revisión del plan, cada tarea muestra un **ajustado según tu historial** como
  sugerencia; con `u` se usa como tu estimación (va a Jira), si no queda la recomendada. Sin IA (0 tokens):
  - Medida: **de inicio a fin** (lo que de verdad tomó la tarea, con Claude abierto o no).
  - Factor = real ÷ recomendada de las tareas medidas de la carpeta, del mismo riesgo si hay al menos 3; si no, el
    total. Contra la recomendada y no contra lo enviado a Jira: si ya se usó el ajustado, el factor no se borra solo.
  - Con pocas medidas el factor se acerca a 1: `(n × factor + 5) ÷ (n + 5)`; además queda entre 0,5 y 2.
  - Ajustado = recomendada × factor, redondeado a 5 min. Sin medidas no se muestra nada.

### Parte 7 — Al ejecutar una tarea, los commits los hace el dev (agregada 2026-11-08)

Corrección del dev en una ejecución real (PM-2096): "de los commits siempre me encargo yo; puedes crear ramas
preguntándome desde dónde".
- `jm` le pasa a Claude, al ejecutar una tarea, unos ajustes propios que **niegan** `git commit` y `git push` (la
  negación gana sobre cualquier permiso del dev o del proyecto). Sin Talos: es parte de `jm`.
- Crear ramas sigue permitido, pero la skill `ejecutar` pregunta antes desde qué rama base.
- Al terminar, Claude resume lo hecho y no ofrece commits.

### Parte 8 — Relaciones en el grafo de la base (agregada 2026-11-08)

El dev ve el grafo de Obsidian disperso: las notas de `06-JM-ADR` casi no se enlazan. Todo lo hace `jm` (0 tokens):
1. Nota de tarea: ficha (historia, tarea, `tipo/tarea`), `Historia: [[CLAVE]]` como enlace y las tareas anteriores
   enlazadas; sin la instrucción técnica para Claude ni el criterio de terminado repetido. El estado de cada tarea se
   muestra en la sección de la historia (siempre al día) y no en la ficha de la tarea (quedaría vieja).
2. Nota de la historia: `jm` mantiene una sección `## Tareas` con un enlace por tarea y su estado, y pone al día `fase`
   y `tareas` de la ficha.
3. `historia.md` y `bitacora.md` empiezan con `Historia: [[CLAVE]]`.
4. Índice: las tareas con nota pasan a enlaces.
5. Las notas existentes se reparan una sola vez, solo dentro de `06-JM-ADR`.

### Parte 9 — Tarea de Planificación al entrar a una historia (agregada 2026-11-09)

El análisis y la replanificación también son trabajo y deben quedar registrados sin depender de Jira. Sin IA (0 tokens):
1. Cada vez que el dev entra a una historia (la primera vez o al volver), antes del chat `jm` pregunta si registra
   una tarea de Planificación. Si ya hay una abierta en esa historia, no pregunta: avisa que sigue en ella.
2. Si dice que sí: estimación sugerida (1h; con Planificaciones finalizadas, el promedio de lo real de inicio a fin) y
   fecha sugerida hoy, ambas editables. Se crea de una vez en Jira bajo la historia, con el responsable de siempre,
   título `Planificación · AAAA-MM-DD`, y queda iniciada ("En curso") para medir su tiempo.
3. Al salir del chat, si hay una Planificación abierta, `jm` pregunta si terminó; si no, se finaliza otro día desde
   tareas.
4. No entra en el factor de ajuste de las tareas del plan (no tiene estimación de Claude); la calibración la muestra
   aparte. Se lista en la nota de la historia en la base.

### Parte 10 — Análisis sin historia y registro de gestión por tablero (agregada 2026-11-09)

Caso real: piden analizar y estimar observaciones antes de que exista una historia en Jira (MineTrack, 8
observaciones que luego se repartieron en varias historias). El análisis también es trabajo y debe quedar registrado.

**A. Registro de gestión por tablero (sin IA)**
1. La primera vez que el dev se conecta a un tablero, `jm` pregunta si hay una épica o historia de gestión
   (reuniones, análisis, coordinaciones). Si dice que sí, elige cuál y queda guardada para ese tablero; se puede cambiar
   después.
2. Con gestión configurada, **todas** las tareas de análisis van ahí: las de un análisis suelto y también la
   Planificación de la Parte 9 al entrar a una historia existente.
3. Sin gestión configurada: la Planificación de la Parte 9 se queda en la misma historia (como hoy); un análisis suelto
   pregunta si se crea la tarea de análisis y dónde (épica o historia del tablero, o no registrarla).
4. Bajo una historia se crea como subtarea; bajo una épica, como tarea hija. Misma mecánica que la Parte 9: estimación y
   fecha sugeridas y editables, queda "En curso" y al salir pregunta si terminó. Título `Análisis · <nombre> ·
   AAAA-MM-DD` (suelto) o `Planificación · <CLAVE> · AAAA-MM-DD` (historia, cuando va a gestión).

Plan técnico 10A (aprobado 2026-11-09):
- Se guarda en `.jira.json` de la carpeta, por proyecto: `management: { "<PROYECTO>": { key, summary } | null }`
  (`null` = respondió que no tiene; no se vuelve a preguntar). Cambiar de proyecto no arrastra el valor.
- Pregunta tras elegir proyecto con `p` y al entrar a una historia de un proyecto que nunca respondió (antes de la
  Planificación). Se cambia con `g` desde el inicio. Elegir: lista de épicas (Enter) o `k` para escribir la clave de
  una historia o épica; se valida que exista, no esté finalizada y no sea subtarea.
- Con gestión, la Planificación se titula `Planificación · <CLAVE> · AAAA-MM-DD`; su registro, tiempo, cierre y
  calibración siguen en la historia donde se entró.
- Si la de gestión ya no sirve (finalizada o inexistente), se crea en la historia actual y se avisa que se cambie con `g`.

**B. Análisis sin historia**
1. Desde el inicio, "Nuevo análisis": nombre y fuentes (texto pegado, rutas de archivos `.md/.txt/.pdf/.eml`, fotos o
   capturas). Queda en la base con un id local, sin Jira.
2. Debate con Claude leyendo el código real; identifica **puntos**, cada uno con análisis, propuesta y estimación.
3. Al cerrar el debate se generan los 3 documentos en la carpeta del análisis: `análisis_propuesta.md` (técnico),
   `observaciones_funcional_tecnico.md` (qué pasa hoy / qué vamos a hacer) y `resumen_observaciones.md` (cliente, sin
   términos técnicos).

Plan técnico 10B (aprobado 2026-11-09), en dos commits:
- **10B-1 (sin IA):** el análisis es un tipo propio, no una historia: carpeta `NN-JM-ADR/analisis/an-<n>/` (id en
  minúsculas para no confundirse con una clave de Jira) con `estado.json`, `fuentes/`, `bitacora.md`. En el inicio, `a`
  → "Nuevo análisis": nombre, rutas de archivos (`.md .txt .pdf .eml .png .jpg .jpeg`, con tope de tamaño también para el texto pegado) y texto pegado;
  `jm` los copia a `fuentes/` (texto en `fuentes/texto.md`) y se pueden agregar más después. Aparece en la lista del
  inicio con la marca `[análisis]`. Al entrar (primera vez y al volver) pregunta por la tarea `Análisis · <nombre> ·
  AAAA-MM-DD`: con gestión va ahí; sin gestión pregunta dónde (épica de la lista o clave con `k`) o no registrarla;
  queda En curso, al salir pregunta si terminó y la calibración la muestra junto a las Planificaciones.
- **10B-2 (con IA):** skill `analizar`: lee fuentes y código real, identifica y debate los puntos, guarda `puntos.json`
  (título, análisis, propuesta, estimación PERT, fuera de alcance) y al cerrar escribe los 3 documentos con Sonnet
  (modo profundo con Opus si el dev lo pide). Permisos de Claude propios del análisis, sin tocar los de historias.

Ajustes 10B-2 tras la prueba de 10B-1 (2026-11-09):
- Fuentes desde la base: "Agregar notas de la base" con el navegador de carpetas existente; las notas quedan
  **referenciadas** (no se copian) y Claude las lee directo del vault, siempre al día.
- Continuar una sesión de Claude Code (terminal o VS Code comparten el historial por carpeta): `jm` lista las sesiones
  de la carpeta del proyecto (fecha, primer mensaje, tamaño); al elegir una, el chat del análisis la continúa como
  copia (*fork*, la original queda intacta) con la skill `analizar` encima. Si es muy larga, avisa del costo y ofrece
  importarla como fuente (`fuentes/sesion-<fecha>.md`, conversación limpia).

**C. Vincular después (manual)**
1. "Vincular" en el análisis: el dev asigna cada punto a una historia de Jira (todos a una, uno a uno o por grupos).
2. Cada historia vinculada arranca con su parte del análisis y su estimación como contexto de `/refinar`.
3. Vincular no registra tiempo: ya quedó en la tarea de análisis.

### Parte 4 — Ejecución tarea por tarea (idea registrada 2026-11-05, por diseñar)

Elegir una tarea, iniciarla (pasa a "En curso"/"In Progress"), trabajar con Claude con ese contexto y al terminarla
pasarla a "Finalizada". Finalizar solo cambia el estado: **la estimación original no se toca**. El tiempo real se
registra aparte para la calibración estimado vs. real.

Decisión del dev (2026-11-05): **opción B**. Iniciar una tarea abre Claude Code completo con el contexto de esa tarea
(se ve lo que toca y pide permisos a su manera, menos tokens que replicarlo en `jm`); se trabaja ahí hasta terminarla y
al salir con `/exit` se vuelve a `jm`, que pregunta si se terminó para pasarla a "Finalizada".

Diseño aprobado (2026-11-05, "todo del plan me agrada"):
- Pantalla "Tareas" de la historia: subtareas creadas con su estado real en Jira, estimación y fecha.
- `i` iniciar: transición a "En curso", hora de inicio local, y Claude completo con el contexto de la tarea (título,
  descripción, criterio de terminado, bitácora, nota JM-ADR y lo hecho en tareas anteriores), con la base de
  conocimiento conectada por el intermediario.
- Al terminar, Claude agrega a la nota JM-ADR y a la bitácora una sección por tarea: qué se hizo, archivos tocados,
  decisiones y pendientes. Así se puede retomar a medias, otro día o desde otra carpeta.
- Al volver con `/exit`: "¿Terminaste la tarea?" → sí: "Finalizada" (sin tocar la estimación original) y tiempo real
  guardado localmente; no: queda "En curso".

Agregado por el dev (2026-11-05), todo sin IA (lectura directa de Jira, 0 tokens):
- La pantalla "Tareas" lee el estado real de Jira al entrar y con `r`; filtro de pendientes ("Por hacer"/"En curso")
  con resumen ("3 de 7 finalizadas · 4h30m pendientes").
- Muestra todas las subtareas de la historia, incluidas las no creadas por `jm` (marcadas "no es del plan"), con
  estado y persona asignada, para que el dev decida.
- Borrado masivo a criterio del dev: marcar varias y `d`; muestra la lista exacta y pide escribir `borrar`. Se quitan
  del registro de la historia. Si Jira no da permiso, se avisa.
- Finalizadas: bloqueadas para borrar y editar.
- En curso: no se borran directo; se pueden devolver a un estado anterior (las transiciones disponibles del proyecto,
  p. ej. Backlog / Por hacer) y después borrar.

- "Mi día" (tecla `h` en el inicio): tareas de Jira asignadas al dev que vencen hoy o están vencidas, de cualquier
  historia, con total de horas contra 8 h; se pueden iniciar desde ahí. Solo lectura de Jira, sin IA.
- En la pantalla de Tareas, el plan se puede ver en solo lectura.

Ajuste previo (en 3.4): al reabrir una conversación existente, `jm` no le manda nada a Claude; muestra el historial y
espera al dev. El primer mensaje del dev retoma la sesión (o la reconstruye desde la bitácora si ya no existe).

## Fuera de alcance

- Fase 2: `list` / `get` / `move` / `edit` / `use` como pantallas de la app.
- Fase 3: calibración (estimado vs. tiempo real registrado en Jira).
- Vista previa de imágenes dentro de la terminal.

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/tui/app.mts`, `src/tui/screens/*.mts`, `src/tui/components/*.mts` | App Ink: PIN, inicio, revisión del plan, creación, cierre. |
| `src/commands/refine.ts` | `jm refinar [issueKey]`: prepara la carpeta, descarga, lanza o retoma Claude, abre la revisión. |
| `src/commands/import.ts` | `jm import <plan.json>`: creación idempotente (también usada por la app). |
| `src/refinement/state.ts`, `src/refinement/plan.ts`, `src/refinement/pert.ts` | Estado y fases, validación del plan, cálculo PERT. |
| `src/services/jira.ts` | `createIssue` con `description`; `getAttachments`, `downloadAttachment`, `uploadAttachment`. |
| `src/utils/adf.ts` | `markdownToAdf` (párrafos, listas). |
| `src/config/types.ts` | `RefinementPlan`, `PlannedTask`, `RefinementState`, `Attachment`. |
| `assets/skills/refinar/SKILL.md` | Skill del debate (incluida en `files` del paquete). |
| `src/scripts/postinstall.ts` | Copia la skill a `~/.claude/skills/refinar/`. |
| `src/cli/program.ts`, `src/commands/help.ts`, `src/commands/shell.ts` | Registrar comandos; `jm` sin argumentos abre la app. |
| `tsconfig.json`, `package.json` | `module: node16`; dependencias `ink`, `react`, `ink-text-input`; script de tests. |

## Criterios de aceptación

- **CA1** Dado una historia sin refinar, cuando ejecuto `jm refinar AQ-45`, entonces se crea `.jm/historias/AQ-45/` con
  `historia.md` y los adjuntos de la HU, y se abre Claude con `/refinar AQ-45`.
- **CA2** Dado un debate a medias y la consola cerrada, cuando vuelvo a abrir `jm`, entonces el inicio muestra AQ-45 en
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
- **CA9** Dado una carpeta con `.jira.json` y proyecto sin base decidida, cuando abro una historia, entonces `jm` pregunta por la base
  (MCP, carpeta local o ninguna), me deja navegar sus carpetas para elegir la base, y guarda la elección sin la API key.
- **CA10** Dado un MCP con certificado propio, cuando lo configuro, entonces `jm` muestra la huella y solo con mi confirmación
  guarda el certificado y lo usa para verificar TLS; nunca se desactiva la verificación.
- **CA11** Dado el chat con MCP, cuando Claude pide `tools/list` o llama una herramienta, entonces el intermediario local solo expone
  lectura/búsqueda y `vault_write`/`vault_append`, rechaza el resto sin reenviarlo, y Claude nunca recibe la key.
- **CA12** Dado que la base no responde o la key falla al abrir, entonces el chat muestra el error y no se abre.
- **CA13** Dado una base con carpeta `*JM-ADR` (o sin ella), cuando abro la historia, entonces Claude escribe solo en `<JM-ADR>/<KEY>.md`;
  en otra carpeta conectada a la misma base, la historia se retoma desde esa nota.

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
| Commit renombre JM-SHELL | Marcello Cano | 2026-11-04 | aprobado; instalador nuevo pendiente de prueba |
| Accept parte 2.5 (explorar Jira) | Marcello Cano | 2026-11-04 | aprobado ("claro") |
| Commit parte 2.5 | Marcello Cano | 2026-11-04 | aprobado ("okey genial", probado: abre Claude desde la app) |
| Accept parte 2.6 (debate en la app + modelos) | Marcello Cano | 2026-11-04 | aprobado ("me gusta") |
| Commit parte 2.6 | Marcello Cano | 2026-11-04 | aprobado ("si apruebo"); prueba en terminal real pendiente |
| Accept parte 2.7 (presentación + carpeta por proyecto) | Marcello Cano | 2026-11-04 | aprobado ("si") |
| Commit parte 2.7 | Marcello Cano | 2026-11-04 | aprobado ("si apruebo"); prueba en terminal real pendiente |
| Accept parte 3 (revisión, creación, cierre) | Marcello Cano | 2026-11-05 | aprobado ("si"); con observaciones de carpeta de código y scroll del chat |
| Accept parte 3.1 (carpeta independiente + scroll) | Marcello Cano | 2026-11-05 | aprobado ("todo lo demás okey"); sin mapeo global |
| Commit parte 3 + 3.1 | Marcello Cano | 2026-11-05 | aprobado ("apruebo continuemos"); review 3 dimensiones aplicada; prueba en terminal real pendiente |
| Accept parte 3.2 (base de conocimiento) | Marcello Cano | 2026-11-05 | aprobado ("lo demás genial, está conforme"); MCP o carpeta local; numeración de Conocimiento |
| Accept plan técnico 3.2 | Marcello Cano | 2026-11-05 | aprobado (1 sí, 2 sí, 3 avisa y bloquea, 4 después); + navegador de carpetas de la base |
| Accept intermediario MCP 3.2 | Marcello Cano | 2026-11-05 | aprobado ("okey genial, sí vamos con intermediario") |
| Commit parte 3.2 | Marcello Cano | 2026-11-05 | aprobado ("okey genial apruebo"); review 3 dimensiones + re-review seguridad (0 bloqueantes); prueba real con Obsidian pendiente |
| Commit fix teclado + /mcp + adjuntos | Marcello Cano | 2026-11-05 | aprobado ("okey genial si"); probado escribiendo en el chat real |
| Accept parte 3.5 (estado en la base, sin .jm en el repo) | Marcello Cano | 2026-11-05 | aprobado ("me queda claro y apruebo"); migración automática; antes de la 4 |
| Accept plan técnico 3.5 | Marcello Cano | 2026-11-05 | aprobado ("okey sí genial"); recomendaciones 1-3, conexiones de notas sí, Graphify no; prueba en _jm-prueba autorizada |
| Commit parte 3.5 | Marcello Cano | 2026-11-05 | aprobado ("sí apruebo, continuemos"); migración probada en real; review 2 dimensiones + re-review seguridad |
| Commit parte 4 | Marcello Cano | 2026-11-06 | aprobado ("apruebo"); review combinada aplicada; la revisión del plan oculta las tareas ya creadas |
| Commit finalizar directo + transiciones por tipo | Marcello Cano | 2026-11-06 | aprobado tras prueba real ("probé, exitoso") |
| Commit parte 5 + ajustes (orden de tareas, descripción sin estimación, `r` tras crear) | Marcello Cano | 2026-11-07 | aprobado tras prueba ("listo, apruebo") |
| Accept parte 6 (calibración, puntos 1 y 2) | Marcello Cano | 2026-11-07 | aprobado: A ambas medidas, B sin worklog, C fórmula propia después |
| Commit parte 6 (calibración, puntos 1 y 2) | Marcello Cano | 2026-11-08 | aprobado tras prueba ("está excelente, queda lo apruebo") |
| Accept parte 7 (sin commits al ejecutar, ramas preguntando la base) | Marcello Cano | 2026-11-08 | aprobado ("si") |
| Accept parte 8 (relaciones en el grafo de la base: 5 puntos) | Marcello Cano | 2026-11-08 | aprobado ("si aceptalo") |
| Commit partes 7 y 8 (lo hizo el dev en `addc94d`) | Marcello Cano | 2026-11-09 | aprobado ("listo quedo genial aunqeu ya comitie creo ajaja") |
| Accept parte 6 punto 3 (ajuste por historial, de inicio a fin, como sugerencia) | Marcello Cano | 2026-11-09 | aprobado ("acept"; medida: "la duración de inicio a fin") |
| Accept parte 9 (tarea de Planificación al entrar a una historia) | Marcello Cano | 2026-11-09 | aprobado ("si ojo tanto al vovler como al ingresar a una por primera vez") |
| Prueba real parte 9 (tras review 3 dimensiones aplicada) | Marcello Cano | 2026-11-09 | exitosa ("funcionó completamenteeeee") |
| Commit parte 9 + parte 6 punto 3 (un solo commit) | Marcello Cano | 2026-11-09 | aprobado ("si") |
| Accept parte 10 (análisis sin historia + gestión por tablero) | Marcello Cano | 2026-11-09 | aprobado (diseño A/B/C; con gestión configurada también la Planificación de historias va ahí, si no en la misma historia) |
| Accept plan técnico 10A (gestión por tablero) | Marcello Cano | 2026-11-09 | aprobado ("okey genial si"); si la de gestión no sirve, se crea en la historia actual y avisa |
| Prueba real parte 10A (tras review 2 revisores aplicada) | Marcello Cano | 2026-11-09 | exitosa ("genial quedó") |
| Commit parte 10A | Marcello Cano | 2026-11-09 | aprobado ("si") |
| Accept plan técnico 10B (análisis tipo propio, fuentes copiadas, tecla a, 2 commits) | Marcello Cano | 2026-11-09 | aprobado ("okey si me agrada"); documentos con Sonnet (recomendado) |
| Prueba real 10B-1 (tras review 2 revisores aplicada) | Marcello Cano | 2026-11-09 | exitosa ("todo genial"); pide notas del vault y continuar sesión |
| Commit 10B-1 | Marcello Cano | 2026-11-09 | aprobado ("si lo apruebo") |
| Accept ajustes 10B-2 (notas del vault referenciadas, continuar sesión de Claude Code con fork) | Marcello Cano | 2026-11-09 | aprobado ("si referenciadas"; sesión de VS Code continuada) |
| Accept parte 5 (reconfigurar base, opción A ahora, B después) | Marcello Cano | 2026-11-06 | aprobado ("por ahorita vamos con la …, la B en otra actualización") |
| Accept "Mi día" en parte 4 | Marcello Cano | 2026-11-05 | aprobado: vista de tareas propias que vencen hoy o vencidas, de cualquier historia |
| Accept parte 4 (ejecución, opción B + registro en JM-ADR) | Marcello Cano | 2026-11-05 | aprobado ("todo del plan me agrada, continúa") |
| Commit 3.3 + 3.4 | Marcello Cano | 2026-11-05 | aprobado ("haz el reajuste, luego commiteamos"); review por partes aplicada |
| Accept parte 3.4 (interfaz pulida) | Marcello Cano | 2026-11-05 | aprobado ("sí, primero pruebas y luego de corrido") |
| Accept parte 3.3 (estimación propia, fechas, chat, skill) | Marcello Cano | 2026-11-05 | aprobado (desde hoy, 8 h/día recomendado, sin descontar Jira, fechas editables) |
