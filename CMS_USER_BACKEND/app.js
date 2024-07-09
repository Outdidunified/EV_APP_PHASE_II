const express = require('express');
const app = express();
const http = require('http');
const dotenv = require('dotenv');
const logger = require('./logger');
const cors = require('cors');
app.use(cors());

// Load environment variables from .env file
dotenv.config();

const home = require('./src/Home/routes.js');
const wallet = require('./src/Wallet/routes.js');
const sessionhistory = require('./src/SessionHistory/routes.js');
const profile = require('./src/Profile/routes.js');

app.use(express.json());


app.use((req, res, next) => {
    console.log(`${req.method} request for '${req.url}'`);
    next();
});


app.use('/', home);
app.use('/wallet', wallet);
app.use('/session', sessionhistory);
app.use('/profile', profile);


// Create an HTTP server using Express app
const httpServer = http.createServer(app);

// Define HTTP server port
const HTTP_PORT = process.env.HTTP_PORT || 9098;    

// Start the HTTP server
httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP Server listening on port ${HTTP_PORT}`);
    logger.info(`HTTP Server listening on port ${HTTP_PORT}`);
});
