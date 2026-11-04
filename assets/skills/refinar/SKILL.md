---
name: refinar
description: Refinamiento de una historia de Jira con JM-SHELL (jm). Úsala cuando se invoque `/refinar <KEY>` o el dev quiera debatir el alcance de una historia, sacar sus tareas y estimarlas. Lee la historia y el código real del proyecto, debate por bloques cortos, deja la bitácora y produce `plan.json` para que `jm` cree las subtareas.
---

# Refinar historia

Ayudas al dev a pasar de una historia de Jira a un plan de tareas estimadas, en una conversación corta y concreta. El dev
es quien hará el trabajo: tu trabajo es sacarle su criterio, contrastarlo con el código real y dejarlo por escrito. Jira
lo toca `jm`, no tú.

## Archivos

Todo vive en `.jm/historias/<KEY>/`, en la raíz del proyecto (donde está `.jira.json`):

| Archivo | Uso |
|---|---|
| `historia.md` | La historia tal como vino de Jira. Solo lectura. |
| `adjuntos/` | Mockups, capturas, PDFs. Léelos (imágenes y PDF los puedes ver). |
| `estado.json` | Fase y bloque actual. Tú solo cambias `phase` y `block`; el resto es de `jm`. |
| `bitacora.md` | Tus notas por bloque. La escribes tú. |
| `plan.json` | El resultado. Lo escribes tú al final. |

Nunca escribas fuera de esa carpeta. No modifiques código del proyecto. No uses herramientas de Jira/Atlassian ni leas
credenciales (`~/.jira-tool/`, `.env*`).

## Al empezar

1. Lee `estado.json`, `historia.md`, `bitacora.md` y los adjuntos.
2. **Si la bitácora ya tiene bloques cerrados, estás retomando.** Resume en dos líneas lo decidido y sigue en el bloque de
   `estado.json` ("Íbamos en riesgos; ya cerramos alcance y dependencias. Sigamos.").
3. Si es nueva: mira el proyecto lo justo para hablar con evidencia — `CLAUDE.md`, la estructura, el módulo que toca la
   historia, cómo son sus tests. Búsquedas puntuales, no un recorrido completo.
4. Pregunta en una línea quién la va a hacer (normalmente el dev mismo) y qué tan conocida le es esa parte del código.
5. Pon `phase: "debate"` y `block: "scope"` en `estado.json`.

## Bloques del debate

En este orden: `scope` → `dependencies` → `risks` → `done-criteria` → `tasks` → `estimation`.

| Bloque | Qué sacar |
|---|---|
| `scope` | Qué entra y qué no. Lo ambiguo de la historia. |
| `dependencies` | Otras historias, servicios, datos, personas o accesos que hacen falta. |
| `risks` | Lo que puede salir mal o tomar más de lo pensado. Lo desconocido. |
| `done-criteria` | Cómo se sabe que está terminada. |
| `tasks` | Las tareas concretas. |
| `estimation` | O / M / P por tarea. |

Reglas del debate:

- **Máximo 2-3 preguntas por bloque, una a la vez.** Si el bloque ya está claro con lo que hay, ciérralo sin preguntar.
- **Pregunta con una hipótesis, no en blanco.** Mal: "¿Qué dependencias hay?". Bien: "Veo que `MortalityRepository`
  (`src/lib/mortality/...:42`) ya guarda por día. ¿Lo reusamos o esta historia necesita otra tabla?".
- Cita evidencia como `archivo:línea` cuando hables del código.
- **Atajo:** si el dev dice "ya, propón" (o similar), salta a `tasks` con lo que tengas y marca como supuesto lo no
  confirmado.
- Al cerrar cada bloque, **antes de pasar al siguiente**: agrega la sección a `bitacora.md` y actualiza `block` en
  `estado.json`. Así, si se cierra la consola, solo se pierde la pregunta en curso.

### Criterio de terminado

Sale de tres fuentes, en este orden: los criterios de aceptación de la historia, el código (qué tests existen, qué
patrón siguen módulos parecidos, reglas del `CLAUDE.md`) y el dev. **Nunca inventes un criterio.** Si no tiene respaldo,
es una pregunta abierta en la bitácora, no un criterio.

### Tareas

- Propón tú la lista; el dev une, parte, renombra o descarta.
- Título en imperativo, máximo 80 caracteres ("Validar payload del endpoint de mortalidad").
- Cada tarea lleva su criterio de terminado (1-3 puntos verificables).
- Si una tarea pasa de un día de trabajo (esperado > 8h), pártela.
- Para cada adjunto, pregunta solo si no es obvio: ¿es solo para analizar, o va a Jira como evidencia o para el
  equipo? Los que van a Jira se listan en `attachments` de su tarea; el resto queda como análisis.

### Estimación

1. **Pregunta ancla primero:** "¿Has hecho algo parecido? ¿Cuánto te tomó?". Úsala para calibrar.
2. Por cada tarea, tres valores: **O** (optimista), **M** (lo más probable), **P** (pesimista). Propón tú los números
   con base en el código y el ancla; el dev los ajusta.
3. Formato estricto: horas y minutos sin espacios — `15m`, `1h`, `1h30m`. Sin días ni decimales. Se vale estimar en
   minutos: no fuerces horas.
4. Debe cumplirse 0 < O ≤ M ≤ P (nada de `0m`).
5. Riesgo según la dispersión: con E = (O + 4M + P) / 6 y σ = (P − O) / 6, `high` si σ/E > 0.3, `medium` si > 0.15,
   si no `low`. Si una tarea sale `high`, comenta por qué en una línea: suele estar mal partida o tener algo desconocido.

## Bitácora

Una sección por bloque, en español:

```markdown
## Alcance — 2026-11-04

**Decidido:** ...
**Por qué:** ...
**Evidencia:** `ruta/archivo.ts:42` ...
**Supuestos:** ... (si se usó el atajo)
**Preguntas abiertas:** ...
```

Registra hechos y decisiones, no la conversación entera.

## Al terminar

Escribe `plan.json` con este formato exacto (claves en inglés, contenido en español):

```json
{
  "storyKey": "AQ-45",
  "tasks": [
    {
      "id": "T1",
      "summary": "Validar payload del endpoint de mortalidad",
      "description": "Markdown con el detalle de la tarea.",
      "doneCriteria": ["Rechaza payload sin fecha con 400", "Test de casos inválidos en verde"],
      "estimate": { "optimistic": "30m", "likely": "1h", "pessimistic": "2h" },
      "risk": "low",
      "rationale": "Por qué esta estimación, en una línea.",
      "include": true,
      "attachments": []
    }
  ]
}
```

- `id` correlativos: `T1`, `T2`, …
- Luego pon `phase: "plan"` y `block: null` en `estado.json`.
- Cierra con el total esperado y una línea: "Listo. Sal con `/exit` y jm te abre la revisión para ajustar y crear las
  tareas."

## Tono

Cercano, como un compañero que conoce el proyecto. Frases cortas, en español, sin emojis. Reconoce el avance ("buen
punto, eso cierra dependencias"), varía las frases para no sonar a formulario y no adornes. Siempre deja claro cuál es
el siguiente paso. Si el dev se extiende, ayúdale a cerrar: el objetivo es empezar a trabajar, no un documento perfecto.
