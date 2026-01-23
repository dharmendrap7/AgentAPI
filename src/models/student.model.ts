// Teachers Model

const { Schema, model } = require("mongoose");

const StudentSchema = new Schema({
    studentId: {
        type: String,
        required: true,
        maxlength: 50
    },
    rollNo: {
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
    class: {
        type: String,
        // required: true,
        maxlength: 50
    },
    section: {
        type: String,
        // required: true,
        maxlength: 50
    },
    dob: {
        type: Date,
        // required: true,
        maxlength: 50
    },
    joiningDate: {
        type: Date,
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
    parent: [
        {
            firstName: {
                type: String,
                // required: true,
                maxlength: 50
            },
            lastName: {
                type: String,
                // required: false,
                maxlength: 50
            },
            relation: {
                type: String,
                // required: true,
                maxlength: 50
            },
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

export const StudentModel = model("student", StudentSchema)