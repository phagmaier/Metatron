import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

export function inside(root: string, path: string) {
  const part = relative(root, path);
  return (
    part === "" ||
    (!isAbsolute(part) && part !== ".." && !part.startsWith("../"))
  );
}
export function sensitivePath(path: string) {
  return path
    .split(/[\\/]/)
    .some((part) =>
      /^(?:\.git|\.pi|\.env(?:\..*)?|\.aws|\.ssh|\.npmrc|\.netrc|\.pypirc|\.pgpass|id_(?:rsa|ed25519)(?:\..*)?|secrets?(?:\..*)?|credentials(?:\..*)?|auth\.json|.*\.(?:pem|key|p12|pfx))$/i.test(
        part,
      ),
    );
}
export async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await physicalPath(parent), basename(path));
  }
}
