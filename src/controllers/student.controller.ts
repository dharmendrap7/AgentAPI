// Student controller

import { Request, Response, NextFunction } from "express";
import { IResponse } from "../interfaces/response.interface";
import { StudentModel } from "../models/student.model";

export class Student {
    /**
     *  Getting the list of all student
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlGetAllStudent = async (req: Request, res: Response, next: NextFunction) => {
        const response: IResponse = {
            success: false,
            message: "",
            data: [],
            error: ''
        }
        try {
            const allStudentData = await StudentModel.find({ deletedAt: null }, {});
            if (allStudentData) {
                response.success = true;
                response.message = 'Successfully fetched'
                response.data = allStudentData;
            }
            return res.send(response);
        } catch (error) {
            next('error--');
            console.log(`error: ${error}`);
            return res.send(response);
        }
    }

    /**
     * Adding student
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlAddStudent = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const response: IResponse = {
                success: false,
                message: ''
            }
            const studentData = req.body;
            const createdStudentData = await StudentModel.create(studentData);
            if (createdStudentData) {
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