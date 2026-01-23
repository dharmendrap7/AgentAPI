import { DB_NAME, DB_URL } from "./common.config";
const session = require("express-session");
const mongoStore = require("connect-mongodb-session")(session);

// Configuring db
const mongoose = require('mongoose');

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(`${DB_URL}${DB_NAME}`, {
      // useNewUrlParser: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    //   console.error(error?.message);
    process.exit(1);
  }
}

export const store = new mongoStore({
  uri: `${DB_URL}${DB_NAME}`,
  collection: "primeSessions"
});