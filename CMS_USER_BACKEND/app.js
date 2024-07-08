const express = require('express');
const http = require('http');
const path = require('path');
const router = require('./routes');
const logger = require('./logger');
const dotenv = require('dotenv');
const cors = require('cors');
const punycode = require('punycode/');
const bodyParser = require('body-parser');

// Load environment variables from .env file
dotenv.config();

// Create an Express app
const app = express();

// Create an HTTP server using Express app
const httpServer = http.createServer(app);


// Set up middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/', router);
app.use(express.static(path.join(__dirname, 'public')));

// Define HTTP server port
const HTTP_PORT = process.env.HTTP_PORT || 9098;

// Start the HTTP server
httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP Server listening on port ${HTTP_PORT}`);
    logger.info(`HTTP Server listening on port ${HTTP_PORT}`);
});