import { NextFunction } from "express";

// Generating token
var jwt = require('jsonwebtoken');


export const generateToken = (data: any)=> {
    let jwtSecretKey = process.env.JWT_SECRET_KEY;
    // let data = {
    //     time: Date(),
    //     userId: 12,
    // } 
    const token = jwt.sign(data, jwtSecretKey); 
    return(token);
}

export const validateToken = async(req: any, res: any, next: NextFunction) =>{
    try {
        console.log('headers--', req.headers.authorization);
        // let tokenHeaderKey: string = process.env.TOKEN_HEADER_KEY || "token";
        let jwtSecretKey = process.env.JWT_SECRET_KEY;
        const token = (req.headers.authorization.split(' '))[1];

        console.log('validating token--', token);
 
        const verified = await jwt.verify(token, jwtSecretKey);
        console.log('verified--', verified);
        if (verified) {
            console.log("Successfully Verified");
            // return res.send("Successfully Verified");
            next();
        } else {
            // Access Denied
            console.log("access denied");
            return res.status(401).send("access denied");
        }
    } catch (error) {
        // Access Denied
        console.log("Error in authorization");
        return res.status(401).send(error);
    }
}