import { Router } from "express";
import { evalAudioRouter } from "./audio.js";
import { evalRouter as judgeRouter } from "./judge.js";
import { evalRedoRouter } from "./redo.js";
import { evalRetryRouter } from "./retry.js";

/** Everything the evaluation serves under /api/eval: the Claude judge, the cleaned transcript, the "do it better" clip and "try that answer again". */
export const evalRouter = Router();
evalRouter.use(judgeRouter);
evalRouter.use(evalAudioRouter);
evalRouter.use(evalRedoRouter);
evalRouter.use(evalRetryRouter);
