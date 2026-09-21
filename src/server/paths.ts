import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Finds the package root by walking up from a starting module.
 *
 * Anchored on `package.json` rather than on a directory name, so it works from `src/` under tsx and
 * from `dist/` under plain node, and so a directory that happens to share a name with what the
 * caller wants cannot be mistaken for the root.
 */
export function packageRoot(fromUrl: string): string {
  const start = dirname(fileURLToPath(fromUrl));
  let directory = start;

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, "package.json"))) return directory;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(`Could not find a package root above ${start}`);
}
