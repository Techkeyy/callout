// Fonts for the Open Graph images. The TTFs sit beside this file (Bricolage Grotesque and JetBrains Mono, both OFL).
// If a font cannot be read, the image still renders with the default font instead of failing.
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700 | 800;
  style: "normal";
}

async function read(file: string): Promise<ArrayBuffer | null> {
  // Preferred: the bundler-aware URL form. Fallback: the source folder relative to the project root (next.config traces it for deploys).
  try {
    const r = await fetch(new URL("./" + file, import.meta.url));
    if (r.ok) return await r.arrayBuffer();
  } catch {
    /* try the file system */
  }
  try {
    const buf = await readFile(path.join(process.cwd(), "src", "app", "fonts", file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function loadOgFonts(): Promise<OgFont[]> {
  const [b800, b600, mono] = await Promise.all([read("bricolage-800.ttf"), read("bricolage-600.ttf"), read("jbmono-700.ttf")]);
  const out: OgFont[] = [];
  if (b800) out.push({ name: "Bricolage", data: b800, weight: 800, style: "normal" });
  if (b600) out.push({ name: "Bricolage", data: b600, weight: 600, style: "normal" });
  if (mono) out.push({ name: "JetBrains Mono", data: mono, weight: 700, style: "normal" });
  return out;
}
