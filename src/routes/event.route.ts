// user routes
import { Router, Request, Response, NextFunction } from "express"
import { checkSession } from "../middlewares/session.middleware";
import { validateToken } from "../middlewares/jwt.middleware";
import { Events } from "../controllers/event.controller";

const events = new Events();

export const eventRouter = Router();

eventRouter.get('/events', async (req: Request, res: Response, next: NextFunction) =>
    events.ctrlGetAllEvent(req, res, next));

eventRouter.post('/events', async (req: Request, res: Response, next: NextFunction) =>
    events.ctrlAddEvent(req, res, next));