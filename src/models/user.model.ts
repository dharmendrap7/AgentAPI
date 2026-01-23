// User Model

import { userType } from "../enums/common.enum";
const { Schema, model } = require("mongoose");

const UserSchema = new Schema({
    firstName: {
        type: String,
        required: true,
        maxlength: 50
    },
    lastName: {
        type: String,
        required: true,
        maxlength: 50
    },
    email: {
        type: String,
        required: true,
        maxlength: 50,
        unique: true
    },
    password: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: Object.values(userType),
        required: true,
    },
    role: {
        type: Array,
        default: [],
        require: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    deletedAt: {
        type: Date,
        default: Date.now,
    },
});

export const UserModel = model("user", UserSchema)

