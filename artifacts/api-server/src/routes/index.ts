import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ghostwatchRouter from "./ghostwatch";
import ghostExpressRouter from "./ghostExpress";
import ghostspereRouter from "./ghostspere";
import ghostobservationRouter from "./ghostobservation";
import settingsRouter from "./settings";
import openaiRouter from "./openai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ghostwatchRouter);
router.use(ghostExpressRouter);
router.use(ghostspereRouter);
router.use(ghostobservationRouter);
router.use(settingsRouter);
router.use(openaiRouter);

export default router;
