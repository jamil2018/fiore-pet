import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = fileURLToPath(new URL("./", import.meta.url));
const digest = (content) =>
  createHash("sha256").update(content).digest("hex").slice(0, 12);

// Public files only. Every dependency is fingerprinted before its parent file.
export async function buildSite(destination) {
  await mkdir(join(destination, "assets"), { recursive: true });
  const references = new Map();
  async function emit(relative, content) {
    const ext = extname(relative);
    const name = relative.slice(0, -ext.length) + "." + digest(content) + ext;
    await writeFile(join(destination, name), content);
    references.set(relative, name);
    return name;
  }
  function rewrite(content) {
    for (const [original, versioned] of references)
      content = content.replaceAll(original, versioned);
    return content;
  }
  for (const name of await readdir(join(source, "assets"))) {
    if (![".png", ".svg"].includes(extname(name))) continue;
    await emit("assets/" + name, await readFile(join(source, "assets", name)));
  }
  await emit(
    "platform.mjs",
    await readFile(join(source, "platform.mjs"), "utf8"),
  );
  for (const name of ["theme.js", "app.js", "styles.css"]) {
    await emit(name, rewrite(await readFile(join(source, name), "utf8")));
  }
  await writeFile(
    join(destination, "index.html"),
    rewrite(await readFile(join(source, "index.html"), "utf8")),
  );
  return Object.fromEntries(references);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const destination = resolve(process.argv[2] || "_site");
  const assets = await buildSite(destination);
  console.log(
    `Built ${Object.keys(assets).length} fingerprinted assets in ${basename(destination)}`,
  );
}
