---
name: Artifact registration workarounds
description: How to register a react-vite artifact over an existing directory, and how api/design artifacts can get auto-discovered.
---

- `createArtifact({ artifactType: "react-vite", ... })` fails with `ARTIFACT_DIR_EXISTS` if the target directory already exists — it does not adopt/re-register in place.
  **Workaround:** move the real app directory aside (e.g. to `/tmp`), run `createArtifact` to get a fresh scaffold + proper registration/workflow/port wiring, then overlay the real `src/`, `public/`, `index.html`, etc. back into the new scaffold directory. Keep the scaffold's `package.json`/`vite.config.ts`/`tsconfig.json` unless they meaningfully diverge from the real app's.

- `api` and `design` kind artifacts do NOT need `createArtifact` if they already have a valid `.replit-artifact/artifact.toml` on disk — a background discovery process can auto-register them (and their workflows) directly.
  **Why it matters:** if stray duplicate `.replit-artifact` markers exist elsewhere (e.g. in a backup/import directory), the same discovery pass will register duplicate artifacts/workflows from those paths too. Delete stray `.replit-artifact` dirs under any backup trees before/after this discovery runs, and remove any resulting duplicate workflows.
