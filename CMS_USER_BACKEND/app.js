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
const ChargingSession = require('./src/ChargingSession/routes.js');
const wallet = require('./src/Wallet/routes.js');
const sessionhistory = require('./src/SessionHistory/routes.js');
const profile = require('./src/Profile/routes.js');

app.use(express.json());


app.use((req, res, next) => {
    console.log(`${req.method} request for '${req.url}'`);
    next();
});


app.use('/', home);
app.use('/charging', ChargingSession);
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

const { initializeWebSocket } = require('./websocket');


// Create a separate HTTP server for WebSocket
const webSocketServer = http.createServer();
const ClientWebSocketServer = http.createServer();


// Initialize WebSocket connections and map modules on WebSocket server
initializeWebSocket(webSocketServer, ClientWebSocketServer);

// Define WebSocket server port
const WS_PORT = process.env.WS_PORT || 8567;
// const WS_PORT = process.env.WS_PORT || 6060;

// Start the WebSocket server
webSocketServer.listen(WS_PORT, () => {
    console.log(`WebSocket Server listening on port ${WS_PORT}`);
    logger.info(`WebSocket Server listening on port ${WS_PORT}`);
});

// Define client WebSocket server port
const WS_PORT_CLIENT = process.env.WS_PORT_CLIENT || 8566;

// Start the client WebSocket server
ClientWebSocketServer.listen(WS_PORT_CLIENT, () => {
    console.log(`Client WebSocket Server listening on port ${WS_PORT_CLIENT}`);
    logger.info(`Client WebSocket Server listening on port ${WS_PORT_CLIENT}`);
});