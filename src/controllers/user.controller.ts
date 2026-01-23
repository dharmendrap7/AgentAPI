// User controller

import { SALT } from "../configs/common.config";
import { UserModel } from "../models/user.model";
import { Request, Response, NextFunction } from "express";
import { IResponse } from "../interfaces/response.interface";
import { generateToken } from "../middlewares/jwt.middleware";
const bcrypt = require("bcryptjs");

export class User {
    ctrlGetUser = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userData = await UserModel.find({ firstName: 'sam2', lastName: 'hanky' }, {});
            console.log('userData--:', userData);
            return res.send(userData);
        } catch (error) {
            next('error--');
        }
    }

    /**
     * User SignUp
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlSignUpUser = async (req: Request, res: Response, next: NextFunction) => {
        const response: IResponse = {
            success: false,
            message: "",
            error: null
        }
        try {
            const { firstName, lastName, email, password, type } = req.body;

            let userData = await UserModel.findOne({ email: email });
            if (userData) {
                response.message = "Email already registered!"
                return res.send(response);
            }

            const encryptedPass = await bcrypt.hash(password, SALT);
            userData = {
                firstName: firstName,
                lastName: lastName,
                email: email,
                password: encryptedPass,
                type: type
            };

            await UserModel.create(userData);
            response.success = true;
            response.message = "Signup Successful"
            return res.send(response);
        } catch (error) {
            console.log("error--", error);
        }
    }

    /**
     * User SignIn
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlSignInUser = async (req: any, res: any, next: NextFunction) => {
        const response: IResponse = {
            success: false,
            message: "",
            data: {},
            error: null
        }
        try {
            const { email, password } = req.body;
            let userData = await UserModel.findOne({ email: email });

            if (!userData) {
                response.message = "Email not registered!";
                return res.send(response);
            }

            const isValid = await bcrypt.compare(password, userData.password);
            if (!isValid) {
                response.message = "Incorrect password";
                return res.send(response);
            }
            console.log("session-id-before: ", req.session.id);
            req.session.primeToken = email;
            req.session.authorize = true;
            req.session.save;
            const repsonseData = {  
                userId: userData._id,
                firstName: userData.firstName,
                lastName: userData.lastName,
                type: userData.type,
                role: userData.role,
                primeToken: req.session.primeToken,
            }
            const token = generateToken(repsonseData);
            console.log('req.session--', req.session);
            console.log("session-id-after: ", req.session.id);
            response.success = true;
            response.data = {token};
            response.message = "Login Successful";
            return res.send(response);
        } catch (error) {
            console.log("error--", error);
        }
    }

    /**
     * User SignOut
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlSignOutUser = async (req: any, res: any, next: NextFunction) => {
        const response: IResponse = {
            success: false,
            message: "",
            error: null
        }
        try {
            req.session.destroy();
            response.success = true;
            response.message = "Logout Successful";
            return res.send(response);
        } catch (error) {
            console.log("error--", error);
        }
    }
}
