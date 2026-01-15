# Future Features / Improvements

- Tighten validation to reject empty question strings in planning output (`src/logic/schemas.ts`).
- Make prompt template substitution safe for `$` characters in user input (`src/logic/prompts.ts`).
- Revisit the default prompt mode (`conversation` vs `checklist`) to speed minimum taxonomy coverage (`src/logic/planner.ts`).
- Align planning prompt role expectations with free-form role tags (prompt currently lists fixed roles while schema accepts any string) (`resources/prompts/planning.txt`, `src/logic/schemas.ts`).
