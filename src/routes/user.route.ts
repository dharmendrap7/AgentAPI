// user routes
import { Router, Request, Response, NextFunction } from "express";
import { User } from "../controllers/user.controller";

const user = new User();

export const userRouter = Router();

userRouter.get('/users', async (req: Request, res: Response, next: NextFunction) =>
    user.ctrlGetUser(req, res, next)
)

userRouter.post('/sign-up', async (req: Request, res: Response, next: NextFunction) =>
    user.ctrlSignUpUser(req, res, next)
)

userRouter.post('/sign-in', async (req: Request, res: Response, next: NextFunction) =>
    user.ctrlSignInUser(req, res, next)
)

userRouter.post('/sign-out', async (req: Request, res: Response, next: NextFunction) =>
    user.ctrlSignOutUser(req, res, next)
)