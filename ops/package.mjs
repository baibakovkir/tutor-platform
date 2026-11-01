import { cp, mkdir, readdir, rm, copyFile, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const copied = new Set();
// Sequelize loads the PostgreSQL dialect dynamically; Next's tracer does not
// include that dependency tree. Bootstrap also needs a directly importable bcrypt.
async function runtimePackage(name, resolver = require) {
  if (copied.has(name)) return;
  let root;
  try {
    root = path.dirname(resolver.resolve(name + "/package.json"));
  } catch {
    root = path.dirname(resolver.resolve(name));
    while (root !== path.dirname(root)) {
      try {
        if (
          JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
            .name === name
        )
          break;
      } catch {}
      root = path.dirname(root);
    }
  }
  const info = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (info.name !== name)
    throw new Error("Cannot locate runtime package: " + name);
  copied.add(name);
  await cp(root, destination + "/node_modules/" + name, { recursive: true });
  const childRequire = createRequire(path.join(root, "package.json"));
  for (const child of Object.keys(info.dependencies || {}))
    await runtimePackage(child, childRequire);
}
const destination = ".release";
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(".next/standalone", destination, {
  recursive: true,
  filter: (source) => !/(^|\/)\.env($|\.)/.test(source),
});
await cp(".next/static", destination + "/.next/static", { recursive: true });
await runtimePackage("bcryptjs");
await runtimePackage("pg");
await cp("public", destination + "/public", { recursive: true });
await mkdir(destination + "/migrations", { recursive: true });
for (const file of await readdir("src/migrations")) {
  if (!file.endsWith(".ts")) continue;
  await build({
    entryPoints: ["src/migrations/" + file],
    outfile: destination + "/migrations/" + file.replace(".ts", ".cjs"),
    platform: "node",
    target: "node20",
    format: "cjs",
    bundle: true,
    external: ["sequelize", "umzug"],
  });
}
await copyFile("ops/migrate.cjs", destination + "/migrate.cjs");
await copyFile("ops/bootstrap.cjs", destination + "/bootstrap.cjs");
console.log("Standalone release prepared in .release");
