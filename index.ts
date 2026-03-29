import express, { Express} from "express";
const cors = require('cors');
import { connectDB, store } from "./src/configs/db.config";
import { routes } from "./src/routes/index.route";
import { SESSION_SECRET, SESSION_TIMEOUT_LIMIT } from "./src/configs/common.config";
const session = require("express-session");
var cookieParser = require('cookie-parser');
require('dotenv').config();

const app: Express = express();
const port = process.env.PORT || 5000;

app.use(express.json());
const corsOptions = {
  optionsSuccessStatus: 200,
  credentials: true,
  origin:'http://localhost:3000', 
}
app.use(cors(corsOptions));
app.use(cookieParser());



// session
app.use(session({
  secret: SESSION_SECRET,
  store: store,
  resave: false,
  saveUninitialized: true,
  name: 'primeToken',
  cookie: { 
      sameSite: 'strict',
      expires: SESSION_TIMEOUT_LIMIT,
      httpOnly: true,
      secure: false
  },
}));

store.on('error', (error: any)=> {
  console.log(`[Store Error]: ${error}`)
})

// dbconnection;
connectDB();
app.use('/api', routes);

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
  console.log(`worked pid: ${process.pid}`);
});

// TODO - Need to implement with redis, helmet, jwt