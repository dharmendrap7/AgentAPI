// user routes
import { Router, Request, Response, NextFunction } from "express";
import { Student } from "../controllers/student.controller";
import { checkSession } from "../middlewares/session.middleware";

const student = new Student();

export const studentsRouter = Router();

studentsRouter.get('/students', checkSession, async (req: Request, res: Response, next: NextFunction) =>
    student.ctrlGetAllStudent(req, res, next));

studentsRouter.post('/students', checkSession, async (req: Request, res: Response, next: NextFunction) =>
    student.ctrlAddStudent(req, res, next));