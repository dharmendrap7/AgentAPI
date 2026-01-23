// Events Controller


import { Request, Response, NextFunction } from "express";
import { IResponse } from "../interfaces/response.interface";
import { HTTP_REPONSES } from "../constants/http-response.constant";
import { EventsModel } from "../models/event.model";

export class Events {
    /**
     *  Getting the list of all Events
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlGetAllEvent = async (req: any, res: any, next: NextFunction) => {
        const response: IResponse = {
            success: false,
            message: "",
            data: [],
            error: ''
        }
        try {
            const forUser = req.query.forUser;
            const byUser = req.query.byUser;
            let allEventsData: any;
            if(forUser){
                allEventsData = await EventsModel.find({ invitees: forUser }, {});
            }
                
        else {
            allEventsData = await EventsModel.find({ createdBy: byUser }, {});
        }
        
            if (allEventsData) {
                response.success = true;
                response.message = HTTP_REPONSES.FETCHED_SUCCESS.MESSAGE;
                response.data = allEventsData;
            }
            return res.send(response);
        } catch (error) {
            next('error--');
            return res.send(response);
        }
    }

    /**
     * Adding Events
     * @param req 
     * @param res 
     * @param next 
     * @returns 
     */
    ctrlAddEvent = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const response: IResponse = {
                success: false,
                message: ''
            }
            const eventData = req.body;
            const createdEvent = await EventsModel.create(eventData);
            if (createdEvent) {
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