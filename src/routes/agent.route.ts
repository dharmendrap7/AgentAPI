// user routes
import { Router, Request, Response, NextFunction } from "express";
import { checkSession } from "../middlewares/session.middleware";
const multer = require("multer");
import { Agent } from "../controllers/agent.controller";
const storage = multer.memoryStorage();
const upload = multer({ storage });

const agent = new Agent();

export const agentsRouter = Router();

agentsRouter.post('/import-excel', upload.single("file"), async (req: Request, res: Response, next: NextFunction) =>
    agent.ctrlAddAgent(req, res, next));

agentsRouter.get('/testagent', async (req: Request, res: Response, next: NextFunction) =>
    agent.ctrlTestAgent(req, res, next));

agentsRouter.get('/getagents', async (req: Request, res: Response, next: NextFunction) =>
    agent.ctrlGetAgents(req, res, next));

agentsRouter.get('/getzones', async (req: Request, res: Response, next: NextFunction) =>
    agent.ctrlGetZones(req, res, next));

agentsRouter.get('/getRegions', async (req: Request, res: Response, next: NextFunction) =>
    agent.ctrlGetRegions(req, res, next));


// Developer Purpose
// Creating initial tables as Zones, Regions

agentsRouter.post('/createzones', async (req: Request, res: Response, next: NextFunction) =>
    agent.ctrlCreateZones(req, res, next));

agentsRouter.post('/createRegions', async (req: Request, res: Response, next: NextFunction) =>
    agent.ctrlCreateRegions(req, res, next));