import { NextFunction } from "express";
import { HTTP_REPONSES } from "../constants/http-response.constant";

export const checkSession = (req: any, res: any, next: NextFunction) => {
    if (req.session.authorize) {
        console.log(`Found User Session`);
        next();
    } else {
        console.log(`No User Session Found`);
        res.status(HTTP_REPONSES.UNAUTHORIZED.CODE).send(HTTP_REPONSES.UNAUTHORIZED.MESSAGE);
    }
};
