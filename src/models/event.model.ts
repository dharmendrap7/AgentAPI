// Teachers Model

import { eventType, priorityType } from "../enums/common.enum";

const { Schema, model } = require("mongoose");

const EventsSchema = new Schema({
    title: {
        type: String,
        required: true,
        maxlength: 50
    },
    description: {
        type: String,
        required: true,
        maxlength: 50
    },
    start: {
        type: String,
        required: true,
        maxlength: 50
    },
    end: {
        type: String,
        // required: true,
        maxlength: 50
    },
    invitees: {
        type: Array,
        // required: true,
        // maxlength: 50
    },
    createdBy: {
        type: String,
        // required: true,
        maxlength: 50
    },
    priority: {
        type: String,
        enum: Object.values(priorityType),
        // required: true,
        maxlength: 50
    },
    type:{
        type: String,
        enum: Object.values(eventType),
        required: true,
        maxlength: 50
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
        default: null,
    },
});

export const EventsModel = model("events", EventsSchema)