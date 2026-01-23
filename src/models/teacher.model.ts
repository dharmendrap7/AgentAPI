// Teachers Model

const { Schema, model } = require("mongoose");

const TeacherSchema = new Schema({
    empId: {
        type: String,
        required: true,
        maxlength: 50
    },
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
    gender: {
        type: String,
        // required: true,
        maxlength: 50
    },
    qualification: {
        type: String,
        // required: true,
        maxlength: 50
    },
    designation: {
        type: String,
        // required: true,
        maxlength: 50
    },
    joiningDate: {
        type: Date,
        // required: true,
        maxlength: 50
    },
    experience: {
        type: String,
        // required: true,
        maxlength: 50
    },
    email: {
        type: String,
        // required: true,
        maxlength: 50
    },
    phone: {
        type: String,
        // required: true,
        maxlength: 50
    },
    address: [
        {
            line1: {
                type: String,
                // required: true,
                maxlength: 50
            },
            line2: {
                type: String,
                // required: false,
                maxlength: 50
            },
            city: {
                type: String,
                // required: true,
                maxlength: 50
            },
            state: {
                type: String,
                // required: true,
                maxlength: 50
            },
            country: {
                type: String,
                // required: true,
                maxlength: 50
            },
            pin: {
                type: String,
                // required: true,
                maxlength: 50
            }
        }
        ],
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
        default: null,
    },
});

export const TeacherModel = model("teacher", TeacherSchema)