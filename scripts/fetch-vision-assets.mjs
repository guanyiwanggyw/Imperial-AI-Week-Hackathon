// Copies the MediaPipe wasm runtime and downloads the vision models (face, hands, pose) into web/public/mediapipe,
// so eye contact and gesture tracking work without a network connection during the demo.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "web", "public", "mediapipe");
const wasmSrc = path.join(root, "web", "node_modules", "@mediapipe", "tasks-vision", "wasm");

const models = {
  "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  "pose_landmarker_lite.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
};

await fs.mkdir(path.join(out, "wasm"), { recursive: true });
for (const file of await fs.readdir(wasmSrc)) {
  await fs.copyFile(path.join(wasmSrc, file), path.join(out, "wasm", file));
}
console.log("Copied MediaPipe wasm");

for (const [name, url] of Object.entries(models)) {
  const target = path.join(out, name);
  try {
    await fs.access(target);
    console.log(`${name} already present`);
    continue;
  } catch {}
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
    console.log(`Downloaded ${name}`);
  } catch (err) {
    console.warn(`Could not download ${name} (${err.message}). The app will load it from the CDN instead.`);
  }
}
