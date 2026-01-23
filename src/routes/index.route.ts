// Main file for routes

import { eventRouter } from "./event.route";
import { studentsRouter } from "./student.route";
import { teachersRouter } from "./teachers.route";
import { userRouter } from "./user.route";

 export const routes = [userRouter, teachersRouter, studentsRouter, eventRouter];
