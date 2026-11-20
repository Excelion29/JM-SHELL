# Bitácora de fricción — interfaz de jm

Se anota cada vez que algo frena al dev mientras usa jm en trabajo real (diary study + friction log).
No se arregla en caliente: se agrupa por pantalla y se corrige por lotes, empezando por la severidad más alta.

**Severidad (escala de Nielsen):** 0 no es problema · 1 cosmético · 2 menor · 3 mayor · 4 bloqueante.

**Referencias:**
- Heurísticas de usabilidad de Nielsen — https://www.nngroup.com/articles/ten-usability-heuristics/
- Escala de severidad — https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/
- Guías para interfaces de línea de comandos — https://clig.dev/
- 10 principios de diseño para CLIs (Atlassian, 2020; artículo de práctica, no estudio) — https://www.atlassian.com/blog/jira-service-management/10-design-principles-for-delightful-clis

## Registro

| ID | Fecha | Pantalla | Qué intentaba | Qué pasó | Qué esperaba | Heurística | Sev. | Estado |
|----|-------|----------|---------------|----------|--------------|------------|------|--------|
| F-01 | 2026-11-18 | Refinar · primer mensaje | Entender de qué trata PGC-35 | El primer mensaje va directo a hallazgos técnicos; nunca explica el objetivo de la historia | Primero el objetivo en lenguaje simple, luego el análisis técnico | Correspondencia sistema-mundo real (#2) | 3 | Abierto |
| F-02 | 2026-11-18 | Refinar · primer mensaje | Seguir la parte de SAP | Usa jerga sin explicarla (`LoteInspeccion`, polling, `sync-results.step.ts`); no se entiende | Explicación de qué pasa hoy en una frase, el detalle técnico después | Correspondencia sistema-mundo real (#2) | 2 | Abierto |
| F-03 | 2026-11-18 | Refinar · arranque | Debatir sin gastar de más | Explora todo antes de preguntar; pregunta "quién la hace y qué tan conocida" al final; a la primera respuesta ya aparece el aviso "conversación larga, Ctrl+N" | Preguntar al dev qué sabe antes de explorar, y explorar solo lo que falte | Flexibilidad y eficiencia de uso (#7) | 3 | Abierto |
| F-04 | 2026-11-18 | Refinar · historias relacionadas | Saber por qué cita PGC-16, 19 y 24 | No queda claro si las relaciona jm o la IA (es la IA: jm no lee enlaces de Jira) | Ver de dónde sale cada relación | Visibilidad del estado del sistema (#1) | 2 | Abierto |
| F-05 | 2026-11-18 | Refinar · debate | Responder qué se necesita de la recepción | Pregunta como si el dev ya supiera lo que dice la historia; la respuesta estaba en la historia ("dispara el lote") | Que cite la frase de la historia y pregunte solo lo que la historia no responde | Reconocer antes que recordar (#6) | 3 | Abierto |
| F-07 | 2026-11-18 | Salir del chat → crear → iniciar | Pasar de la estimación terminada a crear e iniciar las tareas | Esc, «¿Terminaste?», vuelve al inicio; hay que entrar con `r` a crear, volver al inicio y entrar con `t` a iniciar | Al cerrar, que pregunte si crear las tareas ya y que después de crearlas ofrezca iniciar una | Flexibilidad y eficiencia de uso (#7) | 3 | Abierto |
| F-08 | 2026-11-18 | Al salir («exit») | Volver a la terminal | Quedan restos del marco de jm (bordes de dos anchos) hasta que se expande el panel | Terminal limpia al salir | Estética y diseño minimalista (#8) | 2 | Validado 2026-11-20 |
| F-09 | 2026-11-19 | Salir del chat (historia con tareas ya creadas) | Crear la tarea nueva que salió del debate | No ofreció «¿Creo las tareas?»; tuvo que ir con `r`, `c`, `s` | Que ofrezca crear las tareas nuevas del plan aunque la historia ya tenga tareas | Flexibilidad y eficiencia de uso (#7) | 3 | Validado 2026-11-20 |
| F-10 | 2026-11-19 | Tareas (`t`) | Ver la tarea recién creada | Recién creadas (PGC-256, 257) salen «sin asignar», sin estado y fuera del conteo; en Jira sí están asignadas | La lista igual que Jira | Visibilidad del estado del sistema (#1) | 3 | Validado 2026-11-20 |
| F-11 | 2026-11-20 | Leyenda de teclas (todas las pantallas) | Ver qué teclas hay | Poco visible: todo en gris tenue, la tecla no se distingue de la acción. Observación del equipo de devs en la presentación y del propio dev | Teclas que resalten y se lean de un vistazo | Reconocer antes que recordar (#6) | 2 | Validado 2026-11-20 |
| F-12 | 2026-11-20 | Leyenda de teclas (todas las pantallas) | Encontrar una tecla | Se ve desordenada: hasta 11 acciones seguidas con «·», sin grupos, y al partir la línea corta una acción a la mitad («Esc» / «inicio») | Acciones agrupadas, sin cortes a mitad, salir siempre en el mismo sitio | Estética y diseño minimalista (#8), Consistencia (#4) | 2 | Validado 2026-11-20 |
| F-13 | 2026-11-20 | Cualquier pantalla que habla con Jira | Entender un fallo y qué hacer | Los errores de Jira llegan crudos y en inglés («Jira API error (503): …», «Permission denied: …»); sin red sale «Jira API error (undefined): …» | Qué pasó en español y qué hacer | Ayudar a reconocer y corregir errores (#9) | 3 | Validado 2026-11-20 |
| F-06 | 2026-11-18 | Refinar · debate | Entender la pregunta | "Recepción" tiene dos sentidos (el documento de SAP o el aviso que recibimos); el dev tuvo que preguntar cuál | Términos ambiguos aclarados en la misma pregunta | Correspondencia sistema-mundo real (#2) | 2 | Abierto |

## Fricción del agente

Dónde la IA no encontró algo que existía o recorrió de más para llegar a ello. Sirve de evidencia para diseñar
cómo hacer navegable lo que jm produce (qué está conectado con qué), antes de decidir la solución.

| ID | Fecha | Qué buscaba | Qué pasó | Dónde estaba | Qué lo habría hecho fácil |
|----|-------|-------------|----------|--------------|---------------------------|
| A-01 | 2026-11-18 | Si jm aprende de lo estimado vs lo real | Afirmé que no existía; lo hallé después por casualidad al listar `src/commands` | `src/commands/calibration-loader.ts` + `src/refinement/calibration` | Un índice o mapa de capacidades de jm (qué hace, dónde vive), enlazado desde las skills |
| A-02 | 2026-11-18 | Quién recibe el movimiento 101 de SAP | Afirmó que "no se recibe por ningún lado" | Triggers movidos a la BD de jobs; tarea hecha aparte, sin bitácora ni doc | Un registro de dónde vive cada integración, aunque esté fuera del repo |
| A-03 | 2026-11-18 | Estado del trigger del plan | Afirmó que es un mock; eso fue cierto hasta cierta fecha, hoy ya cambió | Por confirmar con el dev | Fecha o estado vigente junto al dato; la IA debe decir de dónde sacó la afirmación |

## Lotes

<!-- Cuando se arregla un lote: qué IDs cubre, qué se cambió y la fecha. -->

### Lote 1 — arranque y preguntas de `/refinar` · 2026-11-18

- **Cubre:** F-01, F-02, F-03, F-05, F-06 (y A-02, A-03 en lo que toca a cómo se afirma).
- **Cambio:** `assets/skills/refinar/SKILL.md` — «Al empezar» pasos 4–6 (objetivo primero, preguntar antes de explorar,
  cada afirmación con su fuente) y dos reglas en «Formato de cada mensaje» (preguntas ancladas a la historia, términos
  explicados).
- **Aprobado:** Marcello Cano, 2026-11-18, en sesión.
- **Por validar:** en la próxima historia que se refine.
- **No cubre:** F-04 (jm no muestra de dónde salen las relaciones) ni que la IA encuentre lo que vive fuera del repo.

### Lote 2 — del chat a crear e iniciar tareas · 2026-11-18

- **Cubre:** F-07.
- **Cambio:** al salir del chat con el plan listo, preguntar si crear las tareas ya (lleva a la revisión del plan, no
  crea a ciegas); tras crearlas, ofrecer iniciar una (lleva a Tareas).
- **Aprobado:** Marcello Cano, 2026-11-18, en sesión.
- **Corrección del dev (2026-11-18):** pasar por la revisión siguen siendo demasiadas teclas. «Sí» crea todas las
  tareas directo y vuelve a la lista de historias; se quita «¿Iniciar una ahora?». Solo se abre la pantalla de creación
  si falta una decisión real (elegir padre o posibles duplicados en Jira).

### Lote 3 — ofrecer crear tareas nuevas en historias que ya tienen tareas · 2026-11-19

- **Cubre:** F-09.
- **Cambio:** al salir del chat, la oferta no depende de la fase (`plan`/`reviewed`) sino de que el plan tenga tareas
  incluidas que aún no están en Jira (la misma cuenta que usa crear). Si la historia ya tiene tareas, el texto dice
  cuántas son nuevas; «sí» crea solo esas.
- **Aprobado:** Marcello Cano, 2026-11-19, en sesión.

### Lote 5 — leyenda de teclas legible y ordenada · 2026-11-20

- **Cubre:** F-11, F-12.
- **Cambio:** la leyenda pasa de texto corrido a pares tecla–acción: tecla en cyan y negrita, acción en texto normal,
  separadas por espacios; línea divisoria sobre la leyenda; solo se parte entre acciones; Esc siempre al final.
  No cambia ninguna tecla ni lo que hace.
- **Aprobado:** Marcello Cano, 2026-11-20, en sesión.

### Lote 6 — errores de Jira legibles · 2026-11-20

- **Cubre:** F-13.
- **Cambio:** `src/services/jira.ts` reescribe cada error de Jira en español con qué pasó y qué hacer (sin red, 401,
  403, 404, 429, 5xx, 400) y guarda el código HTTP aparte para que el código decida sin leer el texto.
- **No cubre:** errores que no vienen de Jira (Claude, archivos).
- **Aprobado:** Marcello Cano, 2026-11-20, en sesión.

### Lote 4 — tareas recién creadas en la lista de Tareas · 2026-11-19

- **Cubre:** F-10.
- **Cambio:** si una tarea registrada no sale en la búsqueda de Jira (índice aún sin actualizar), se pide directo por su
  clave; solo si Jira dice que no existe queda como «no encontrada en Jira», y eso se muestra en la columna de estado.
- **Aprobado:** Marcello Cano, 2026-11-19, en sesión.

### Validación y commit · 2026-11-20

- **Validado en terminal real:** Marcello Cano, 2026-11-20 (lotes 2 a 6).
- **Revisión:** tres revisores nuevos (correctitud, convenciones, seguridad y rendimiento), sin hallazgos graves; los
  menores se corrigieron antes del commit.
- **Commit aprobado:** Marcello Cano, 2026-11-20, en sesión.
