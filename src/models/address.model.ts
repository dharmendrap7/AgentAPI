// Address Model

const { Schema, model } = require("mongoose");

const AddressSchema = new Schema({
    line1: {
        type: String,
        required: true,
        maxlength: 50
    },
    line2: {
        type: String,
        required: false,
        maxlength: 50
    },
    city: {
        type: String,
        required: true,
        maxlength: 50
    },
    state: {
        type: String,
        required: true,
        maxlength: 50
    },
    country: {
        type: String,
        required: true,
        maxlength: 50
    },
    pin: {
        type: String,
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

export const AddressModel = model("address", AddressSchema)