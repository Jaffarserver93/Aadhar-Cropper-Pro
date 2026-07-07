import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import removebgRouter from "./removebg";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(removebgRouter);

export default router;
