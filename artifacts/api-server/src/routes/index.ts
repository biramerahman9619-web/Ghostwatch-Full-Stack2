import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ghostwatchRouter from "./ghostwatch";
import ghostExpressRouter from "./ghostExpress";
import ghostspereRouter from "./ghostspere";
import ghostobservationRouter from "./ghostobservation";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ghostwatchRouter);
router.use(ghostExpressRouter);
router.use(ghostspereRouter);
router.use(ghostobservationRouter);
router.use(settingsRouter);

export default router;
