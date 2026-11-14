import express from "express";
import path from "node:path";
import fs from "node:fs";
import { DATA_DIR, ROOT, env, integrationStatus } from "./env.js";
import { voiceRouter } from "./voice.js";
import { mediaRouter } from "./media.js";
import { llmRouter } from "./llm.js";
import { sessionsRouter } from "./sessions.js";
import { evalRouter } from "./eval/judge.js";

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/api/status", (_req, res) => res.json(integrationStatus()));
app.use("/api/voice", voiceRouter);
app.use("/api/media", mediaRouter);
app.use("/api/llm", llmRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/eval", evalRouter);

app.use("/generated", express.static(path.join(DATA_DIR, "generated"), { maxAge: "1h" }));
app.use("/media/sessions", express.static(path.join(DATA_DIR, "sessions")));

// In production (npm run build && npm start) the server also serves the built web app.
const webDist = path.join(ROOT, "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api|\/generated|\/media).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.listen(env.port, () => {
  console.log(`Pitch Sparring Partner server on http://localhost:${env.port}`);
  console.log("Integrations:", integrationStatus());
});
