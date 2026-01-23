// Teacher controller

import { TeacherModel } from "../models/teacher.model";
import { Request, Response, NextFunction } from "express";
import { IResponse } from "../interfaces/response.interface";
import { HTTP_REPONSES } from "../constants/http-response.constant";

export class Teacher {
    /**
     *  Getting the list of all teachers
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlGetAllTeacher = async (req: any, res: any, next: NextFunction) => {
        const response: IResponse = {
            success: false,
            message: "",
            data: [],
            error: ''
        }
        try {
            console.log("has session");
            const allTeacherData = await TeacherModel.find({ deletedAt: null }, {});
            if (allTeacherData) {
                response.success = true;
                response.message = HTTP_REPONSES.FETCHED_SUCCESS.MESSAGE;
                response.data = allTeacherData;
            }
            return res.send(response);


        } catch (error) {
            next('error--');
            return res.send(response);
        }
    }

    /**
     * Adding teacher
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlAddTeacher = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const response: IResponse = {
                success: false,
                message: ''
            }
            const teacherData = req.body;
            const createdTeacherData = await TeacherModel.create(teacherData);
            if (createdTeacherData) {
                response.success = true;
                response.message = 'Created';
            }
            return res.json(response);
        } catch (error) {
            console.log(`error: ${error}`);
            next('error--');
        }
    }
}