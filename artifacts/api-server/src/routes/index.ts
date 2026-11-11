import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import shareholdersRouter from "./shareholders";
import storageRouter from "./storage";
import certificatesRouter from "./certificates";
import transferRequestsRouter from "./transfer-requests";
import historyRouter from "./history";
import settingsRouter from "./settings";
import directoriesRouter from "./directories";
import reportsRouter from "./reports";
import certificateDocumentsRouter from "./certificate-documents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(reportsRouter);
router.use(certificateDocumentsRouter);
router.use(shareholdersRouter);
router.use(historyRouter);
router.use(settingsRouter);
router.use(directoriesRouter);
router.use(certificatesRouter);
router.use(transferRequestsRouter);
router.use(storageRouter);

export default router;
