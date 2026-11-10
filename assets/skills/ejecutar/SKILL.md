---
name: ejecutar
description: Ejecución de una tarea de Jira con JM-SHELL (jm). Úsala cuando se invoque `/ejecutar <HISTORIA> <TAREA>`. Lee el contexto de la tarea, trabaja solo en ella, cumple su criterio de terminado y deja por escrito lo hecho para poder retomarla otro día.
---

# Ejecutar una tarea

Ayudas al dev a hacer UNA tarea de Jira: la que indica el comando `/ejecutar <HISTORIA> <TAREA>`. Si las dos claves son
iguales, la tarea no pertenece a una historia refinada con `jm`: trabaja igual, pero no hay nota ni bitácora que
actualizar. Jira lo toca `jm`, no tú: no cambias estados ni estimaciones.

## Si es un punto de un análisis

Con `/ejecutar an-<N> P<M>` la "tarea" es un punto de un análisis hecho con `jm` (no hay Jira ni historia): el contexto de
sistema trae el texto del análisis y la propuesta de ese punto, y dónde vive la carpeta del análisis. Trabaja solo ese
punto, no toques `estado.json` ni `puntos.json` del análisis y, al terminar o pausar, resume en el chat lo hecho, los
archivos tocados y los pendientes (omite la nota y la bitácora de historia). El resto de las reglas aplican igual.

## Al empezar

1. Lee primero el contexto de la tarea: viene en tu contexto de sistema (título, descripción, criterio de terminado,
   bitácora reciente y las tareas anteriores). Si el contexto remite a `tareas/<TAREA>.md` de la carpeta de la historia,
   léelo también.
2. Si hay tareas anteriores terminadas, lee su archivo `tareas/<CLAVE>.md` solo cuando lo que hicieron afecte a esta tarea.
3. Si hay base de conocimiento conectada, lee la nota de la historia (la ruta viene en tu contexto) antes de tocar código.
4. Dile al dev en dos líneas qué vas a hacer y cuál es el criterio de terminado; después empieza.

## Mientras trabajas

- Trabaja solo en esta tarea. Si descubres algo fuera de alcance, anótalo como pendiente; no lo arregles.
- Cumple el criterio de terminado punto por punto. No des la tarea por terminada si falta alguno: dilo.
- Sigue los patrones del código que ya existe y corre las pruebas que correspondan antes de dar algo por hecho.
- No leas credenciales (`~/.jira-tool/`, `.env*`) ni uses herramientas de Jira.
- Los commits y los push los hace siempre el dev: no los hagas ni los ofrezcas (`jm` los bloquea). Si hace falta una
  rama nueva, pregúntale antes desde qué rama base crearla y créala solo cuando te lo diga.

## Al terminar o al pausar

Deja constancia para poder retomar otro día, incluso desde otra carpeta:

1. En la nota de la historia (carpeta de la base `JM-ADR`, o `.jm/historias/<HISTORIA>/` si no hay base) agrega una
   sección `## <TAREA> · <título>` con: qué se hizo, archivos tocados, decisiones tomadas y pendientes.
2. En `bitacora.md` de la historia agrega una entrada corta (fecha, tarea, una o dos líneas).
3. Si no hay historia (claves iguales), omite los dos pasos anteriores y resume en el chat.

Resume los cambios por repositorio para que el dev haga sus commits, sin ofrecerte a hacerlos.
Después dile al dev: «Escribe /exit para volver a jm; allí te preguntará si terminaste la tarea.»
