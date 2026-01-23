// user routes
import { Router, Request, Response, NextFunction } from "express";
import { Teacher } from "../controllers/teachers.controller";
import { checkSession } from "../middlewares/session.middleware";
import { validateToken } from "../middlewares/jwt.middleware";

const teacher = new Teacher();

export const teachersRouter = Router();

teachersRouter.get('/teachers', [checkSession, validateToken], async (req: Request, res: Response, next: NextFunction) =>
    teacher.ctrlGetAllTeacher(req, res, next));

teachersRouter.post('/teachers', checkSession, async (req: Request, res: Response, next: NextFunction) =>
    teacher.ctrlAddTeacher(req, res, next));