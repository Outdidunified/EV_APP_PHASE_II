const logger = require('./logger');
const { connectToDatabase } = require('./db');
const { generateRandomTransactionId, SaveChargerStatus, updateTime, updateCurrentOrActiveUserToNull,getAutostop,getIpAndupdateUser,chargerStopCall } = require('./functions');

const PING_INTERVAL = 30000; // 30 seconds ping interval

connectToDatabase();

const getUniqueIdentifierFromRequest = (request, ws) => {
    const urlParts = request.url.split('/');
    const firstPart = urlParts[1];
    const identifier = urlParts.pop();
    if (firstPart  === 'steve'){
        // Validate the request method is GET
        if (request.method !== 'GET') {
            ws.terminate();
            console.log(`Connection terminated: Invalid method - ${request.method}`);
            return;
        }
        // Validate that the URL contains 'steve'
        if (!request.url.includes('steve')) {
            ws.terminate();
            console.log(`Connection terminated: URL does not contain 'steve' - ${request.url}`);
            return;
        }
        // Validate required headers
        const headers = request.headers;
        if (headers['connection'] !== 'Upgrade' || headers['upgrade'] !== 'websocket') {
            ws.terminate();
            console.log(`Connection terminated: Missing required headers`);
            return;
        }
        return identifier;
    } else if(firstPart  === 'OCPPJ'){

    } else {
        ws.terminate(); // or throw new Error('Invalid request');
        console.log(`Connection terminate due to Invalid header - ${urlParts}`);
    }
};

const handleWebSocketConnection = (WebSocket, wss, ClientWss, wsConnections, ClientConnections, clients, sessionFlags, charging_states, startedChargingSet) => {
    wss.on('connection', async(ws, req) => {
        // Initialize the isAlive property to true
        ws.isAlive = true;; 
        const uniqueIdentifier = getUniqueIdentifierFromRequest(req, ws);
        const clientIpAddress = req.connection.remoteAddress;
        let timeoutId;
        let timestamp;

        const previousResults = new Map(); //updateTime - store previous result value
        const currentVal = new Map(); //updateTime - store current result value

        previousResults.set(uniqueIdentifier, null);
        wsConnections.set(clientIpAddress, ws);
        ClientConnections.add(ws);
        clients.set(ws, clientIpAddress);

        const db = await connectToDatabase();
        let query = { charger_id: uniqueIdentifier };
        let updateOperation = { $set: { ip: clientIpAddress } };

        if (uniqueIdentifier) {
            console.log(`WebSocket connection established with ${uniqueIdentifier}`);
            logger.info(`WebSocket connection established with ${uniqueIdentifier}`);

            await db.collection('charger_details')
                .updateOne(query, updateOperation)
                .then(async result => {
                    console.log(`ChargerID: ${uniqueIdentifier} - Matched ${result.matchedCount} document(s) and modified ${result.modifiedCount} document(s)`);
                    logger.info(`ChargerID: ${uniqueIdentifier} - Matched ${result.matchedCount} document(s) and modified ${result.modifiedCount} document(s)`);
                    await db.collection('charger_status').updateOne({ charger_id: uniqueIdentifier }, { $set: { ip: clientIpAddress } }, function(err, rslt) {
                        if (err) throw err;
                        console.log(`ChargerID: ${uniqueIdentifier} - Matched ${rslt.matchedCount} status document(s) and modified ${rslt.modifiedCount} document(s)`);
                        logger.info(`ChargerID: ${uniqueIdentifier} - Matched ${rslt.matchedCount} status document(s) and modified ${rslt.modifiedCount} document(s)`);
                    });
                })
                .catch(err => {
                    console.error(`ChargerID: ${uniqueIdentifier} - Error occur while updating in ev_details:`, err);
                    logger.error(`ChargerID: ${uniqueIdentifier} - Error occur while updating in ev_details:`, err);
                });

            clients.set(ws, clientIpAddress);
        } else {
            console.log(`WebSocket connection established from browser`);
            logger.info(`WebSocket connection established from browser`);
        }
    
    

        function connectWebSocket() {
            // Event listener for messages from the client
            ws.on('message', async(message) => {
                const requestData = JSON.parse(message);
                let WS_MSG = `ChargerID: ${uniqueIdentifier} - ReceivedMessage: ${message}`;
                logger.info(WS_MSG);
                console.log(WS_MSG);

                broadcastMessage(uniqueIdentifier, requestData, ws);

                const currentDate = new Date();
                const formattedDate = currentDate.toISOString();


                if (requestData[0] === 3 && requestData[2].action === 'DataTransfer') {//DataTransfer
                    const data = requestData[3]; // Assuming the actual data is in requestData[3]
                
                    // Define the DataTransferRequest schema
                    const dataTransferRequestSchema = {
                        properties: {
                            vendorId: { type: "string", maxLength: 255 },
                            messageId: { type: "string", maxLength: 50 },
                            data: { type: "string" }
                        },
                        required: ["vendorId"],
                        additionalProperties: false
                    };
                
                    // Validation function
                    function validate(data, schema) {
                        const errors = [];
                
                        // Check required fields
                        schema.required.forEach(field => {
                            if (!data.hasOwnProperty(field)) {
                                errors.push(`Missing required field: ${field}`);
                            }
                        });
                
                        // Check properties
                        Object.keys(schema.properties).forEach(field => {
                            if (data.hasOwnProperty(field)) {
                                const property = schema.properties[field];
                                if (typeof data[field] !== property.type) {
                                    errors.push(`Invalid type for field: ${field}`);
                                }
                                if (property.maxLength && data[field].length > property.maxLength) {
                                    errors.push(`Field exceeds maxLength: ${field}`);
                                }
                            }
                        });
                
                        return errors;
                    }
                
                    const errors = validate(data, dataTransferRequestSchema);
                
                    let status;
                    if (errors.length === 0) {
                        status = "Accepted";
                    } else {
                        status = "Rejected";
                    }
                
                    const response = {
                        status: status,
                        data: "",//
                    };
                
                    // Respond with DataTransferResponse
                    const httpResponse = OCPPResponseMap.get(ws);
                    if (httpResponse) {
                        httpResponse.setHeader('Content-Type', 'application/json');
                        httpResponse.end(JSON.stringify(response));
                        OCPPResponseMap.delete(ws);
                    }
                }

                if (Array.isArray(requestData) && requestData.length >= 4) {
                    const requestType = requestData[0];
                    const Identifier = requestData[1];
                    const requestName = requestData[2];

                    if (requestType === 2 && requestName === "BootNotification") {//BootNotification
                        const data = requestData[3]; // Correctly reference the data object
                        // Define the schema
                        const schema = {
                            properties: {
                                chargePointVendor: { type: "string", maxLength: 20 },
                                chargePointModel: { type: "string", maxLength: 20 },
                                chargePointSerialNumber: { type: "string", maxLength: 25 },
                                chargeBoxSerialNumber: { type: "string", maxLength: 25 },
                                firmwareVersion: { type: "string", maxLength: 50 },
                                iccid: { type: "string", maxLength: 20 },
                                imsi: { type: "string", maxLength: 20 },
                                meterType: { type: "string", maxLength: 25 },
                                meterSerialNumber: { type: "string", maxLength: 25 }
                            },
                            required: ["chargePointVendor", "chargePointModel"]
                        };
                    
                        // Validation function
                        function validate(data, schema) {
                            const errors = [];
                    
                            // Check required fields
                            schema.required.forEach(field => {
                                if (!data.hasOwnProperty(field)) {
                                    errors.push(`Missing required field: ${field}`);
                                }
                            });
                    
                            // Check properties
                            Object.keys(schema.properties).forEach(field => {
                                if (data.hasOwnProperty(field)) {
                                    const property = schema.properties[field];
                                    if (typeof data[field] !== property.type) {
                                        errors.push(`Invalid type for field: ${field}`);
                                    }
                                    if (data[field].length > property.maxLength) {
                                        errors.push(`Field exceeds maxLength: ${field}`);
                                    }
                                }
                            });
                    
                            return errors;
                        }
                    
                        const errors = validate(data, schema);
                    
                        const sendTo = wsConnections.get(clientIpAddress);
                        const response = [3, requestData[1], {
                            "currentTime": new Date().toISOString(),
                            "interval": 14400
                        }];
                    
                        if (errors.length === 0) {
                            // All checks passed, send "Accepted" response
                            response[2].status = "Accepted";
                        } else {
                            // Validation failed, send "Rejected" response
                            response[2].status = "Rejected";
                            response[2].errors = errors; // Add errors to the response for debugging
                        }
                    
                        sendTo.send(JSON.stringify(response));
                    } else if (requestType === 2 && requestName === "StatusNotification") { // StatusNotification
                        const data = requestData[3]; // Assuming the actual data is in requestData[3]
                    
                        // Define the StatusNotificationRequest schema
                        const statusNotificationRequestSchema = {
                            properties: {
                                connectorId: { type: "integer" },
                                errorCode: {
                                    type: "string",
                                    enum: [
                                        "ConnectorLockFailure",
                                        "EVCommunicationError",
                                        "GroundFailure",
                                        "HighTemperature",
                                        "InternalError",
                                        "LocalListConflict",
                                        "NoError",
                                        "OtherError",
                                        "OverCurrentFailure",
                                        "PowerMeterFailure",
                                        "PowerSwitchFailure",
                                        "ReaderFailure",
                                        "ResetFailure",
                                        "UnderVoltage",
                                        "OverVoltage",
                                        "WeakSignal"
                                    ]
                                },
                                info: { type: "string", maxLength: 50 },
                                status: {
                                    type: "string",
                                    enum: [
                                        "Available",
                                        "Preparing",
                                        "Charging",
                                        "SuspendedEVSE",
                                        "SuspendedEV",
                                        "Finishing",
                                        "Reserved",
                                        "Unavailable",
                                        "Faulted"
                                    ]
                                },
                                timestamp: { type: "string", format: "date-time" },
                                vendorId: { type: "string", maxLength: 255 },
                                vendorErrorCode: { type: "string", maxLength: 50 }
                            },
                            required: ["connectorId", "errorCode", "status"],
                        };
                    
                        // Validation function
                        function validate(data, schema) {
                            const errors = [];
                            // Check required fields
                            schema.required.forEach(field => {
                                if (!data.hasOwnProperty(field)) {
                                    errors.push(`Missing required field: ${field}`);
                                }
                            });
                    
                            // Check properties
                            Object.keys(schema.properties).forEach(field => {
                                if (data.hasOwnProperty(field)) {
                                    const property = schema.properties[field];
                    
                                    console.log(`Field: ${field}, Expected Type: ${property.type}, Actual Type: ${typeof data[field]}`);
                    
                                    if (property.type === "integer" && !Number.isInteger(data[field])) {
                                        errors.push(`Invalid type for field: ${field}. Expected integer, got ${typeof data[field]}`);
                                    } else if (property.type !== "integer" && typeof data[field] !== property.type) {
                                        errors.push(`Invalid type for field: ${field}. Expected ${property.type}, got ${typeof data[field]}`);
                                    }
                    
                                    if (property.maxLength && data[field].length > property.maxLength) {
                                        errors.push(`Field exceeds maxLength: ${field}`);
                                    }
                    
                                    if (property.enum && !property.enum.includes(data[field])) {
                                        errors.push(`Invalid value for field: ${field}`);
                                    }
                                }
                            });
                    
                            return errors;
                        }
                    
                        const errors = validate(data, statusNotificationRequestSchema);
                    
                        const sendTo = wsConnections.get(clientIpAddress);
                        const response = [3, requestData[1], {}];
                    
                        if (errors.length === 0) {
                            sendTo.send(JSON.stringify(response));
                    
                            const status = requestData[3].status;
                            const errorCode = requestData[3].errorCode;
                            const vendorErrorCode = requestData[3].vendorErrorCode;
                            const timestamp = requestData[3].timestamp;
                    
                            if (status !== undefined) {
                                const keyValPair = {
                                    status: status,
                                    timestamp: timestamp,
                                    clientIP: clientIpAddress,
                                    errorCode: errorCode !== 'InternalError' ? errorCode : vendorErrorCode,
                                    chargerID: uniqueIdentifier
                                };
                                const ChargerStatus = JSON.stringify(keyValPair);
                                await SaveChargerStatus(ChargerStatus);
                            }
                    
                            if (status === 'Available') {
                                timeoutId = setTimeout(async () => {
                                    const result = await updateCurrentOrActiveUserToNull(uniqueIdentifier);
                                    if (result === true) {
                                        console.log(`ChargerID ${uniqueIdentifier} - End charging session is updated successfully.`);
                                    } else {
                                        console.log(`ChargerID ${uniqueIdentifier} - End charging session is not updated.`);
                                    }
                                }, 50000); // 50 seconds delay 
                            } else {
                                if (timeoutId !== undefined) {
                                    console.log('Timeout Triggered');
                                    clearTimeout(timeoutId);
                                    timeoutId = undefined; // Reset the timeout reference
                                }
                            }
                    
                            if (status === 'Preparing') {
                                sessionFlags.set(uniqueIdentifier, 0);
                                charging_states.set(uniqueIdentifier, false);
                                startedChargingSet.delete(uniqueIdentifier);
                            }
                    
                            if (status === 'Charging' && !startedChargingSet.has(uniqueIdentifier)) {
                                sessionFlags.set(uniqueIdentifier, 1);
                                charging_states.set(uniqueIdentifier, true);
                                StartTimestamp = timestamp;
                                startedChargingSet.add(uniqueIdentifier);
                                GenerateChargingSessionID = generateRandomTransactionId();
                                chargingSessionID.set(uniqueIdentifier, GenerateChargingSessionID);
                            }
                    
                            if ((status === 'SuspendedEV') && (charging_states.get(uniqueIdentifier) === true)) {
                                sessionFlags.set(uniqueIdentifier, 1);
                                StopTimestamp = timestamp;
                                charging_states.set(uniqueIdentifier, false);
                                startedChargingSet.delete(uniqueIdentifier);
                            }
                    
                            if ((status === 'Finishing') && (charging_states.get(uniqueIdentifier) === true)) {
                                sessionFlags.set(uniqueIdentifier, 1);
                                StopTimestamp = timestamp;
                                charging_states.set(uniqueIdentifier, false);
                                startedChargingSet.delete(uniqueIdentifier);
                            }
                    
                            if ((status === 'Faulted') && (charging_states.get(uniqueIdentifier) === true)) {
                                sessionFlags.set(uniqueIdentifier, 1);
                                StopTimestamp = timestamp;
                                charging_states.set(uniqueIdentifier, false);
                                startedChargingSet.delete(uniqueIdentifier);
                            }
                    
                            console.log("sessionFlags" + sessionFlags.get(uniqueIdentifier));
                        } else {
                            response[2] = { errors: errors };
                            sendTo.send(JSON.stringify(response));
                        }
                    
                        if (sessionFlags.get(uniqueIdentifier) == 1) {
                            let unit;
                            let sessionPrice;
                            const meterValues = getMeterValues(uniqueIdentifier);
                            console.log(`meterValues: ${meterValues.firstMeterValues} && ${meterValues.lastMeterValues}`);
                            if (meterValues.firstMeterValues && meterValues.lastMeterValues) {
                                ({ unit, sessionPrice } = await calculateDifference(meterValues.firstMeterValues, meterValues.lastMeterValues, uniqueIdentifier));
                                console.log(`Energy consumed during charging session: ${unit} Unit's - Price: ${sessionPrice}`);
                                meterValues.firstMeterValues = undefined;
                            } else {
                                console.log("StartMeterValues or LastMeterValues is not available.");
                            }
                            const user = await getUsername(uniqueIdentifier);
                            const startTime = StartTimestamp;
                            const stopTime = StopTimestamp;
                    
                            await handleChargingSession(uniqueIdentifier, startTime, stopTime, unit, sessionPrice, user, chargingSessionID.get(uniqueIdentifier));
                    
                            if (charging_states.get(uniqueIdentifier) == false) {
                                const result = await updateCurrentOrActiveUserToNull(uniqueIdentifier);
                                chargingSessionID.delete(uniqueIdentifier);
                                if (result === true) {
                                    console.log(`ChargerID ${uniqueIdentifier} Stop - End charging session is updated successfully.`);
                                } else {
                                    console.log(`ChargerID ${uniqueIdentifier} - End charging session is not updated.`);
                                }
                            } else {
                                console.log('End charging session is not updated - while stop only it will work');
                            }
                    
                            StartTimestamp = null;
                            StopTimestamp = null;
                            sessionFlags.set(uniqueIdentifier, 0);
                        }
                    } else if (requestType === 2 && requestName === "Heartbeat") {//Heartbeat
                        const sendTo = wsConnections.get(clientIpAddress);
                        const response = [3, Identifier, { "currentTime": formattedDate }];
                        sendTo.send(JSON.stringify(response));
                        const result = await updateTime(uniqueIdentifier);
                        currentVal.set(uniqueIdentifier, result);
                        if (currentVal.get(uniqueIdentifier) === true) {
                            if (previousResults.get(uniqueIdentifier) === false) {
                                sendTo.terminate();
                                console.log(`ChargerID - ${uniqueIdentifier} terminated and try to reconnect !`);
                            }
                        }
                        previousResults.set(uniqueIdentifier, result);
                    } else if (requestType === 2 && requestName === "Authorize") {
                        const sendTo = wsConnections.get(clientIpAddress);
                        const response = [3, Identifier, { "idTagInfo": { "status": "Accepted", "parentIdTag": "B4A63CDB" } }];
                        sendTo.send(JSON.stringify(response));
                    } else if (requestType === 2 && requestName === "StartTransaction") {
                        let transId;
                        let isChargerStated = false;
                        const sendTo = wsConnections.get(clientIpAddress);
                        const generatedTransactionId = generateRandomTransactionId();
                        await db.collection('charger_details').findOneAndUpdate({ ip: clientIpAddress }, { $set: { transactionId: generatedTransactionId } }, { returnDocument: 'after' })
                            .then(updatedDocument => {
                                transId = updatedDocument.transactionId;

                                const response = [3, Identifier, {
                                    "transactionId": transId,
                                    "idTagInfo": { "status": "Accepted", "parentIdTag": "B4A63CDB" }
                                }];
                                sendTo.send(JSON.stringify(response));
                                isChargerStated = true;
                            }).catch(error => {
                                isChargerStated = false;
                                console.error(`${uniqueIdentifier}: Error executing while updating transactionId:`, error);
                                logger.error(`${uniqueIdentifier}: Error executing while updating transactionId:`, error);
                            });

                            if(isChargerStated === true){

                                const user = await getUsername(uniqueIdentifier);
                                const autostop = await getAutostop(user);

                                if (autostop.time_value && autostop.isTimeChecked === true) {
                                    const autostopTimeInSeconds = autostop.time_value * 60 * 1000; // Convert minutes to seconds
                                    // Start the timeout and store the reference
                                    autoStopTimer = setTimeout(async () => {                
                                        console.log('Calling stop route after autostop_time for user:', user);
                                        const ip = await getIpAndupdateUser(uniqueIdentifier);
                                        const result = await chargerStopCall(uniqueIdentifier, ip);

                                        if (result === true) {
                                            console.log(`AutoStop timer: Charger Stopped !`);
                                        } else {
                                            console.log(`Error: ${result}`);
                                        }

                                    }, autostopTimeInSeconds);
                                }else{
                                    console.error("AutoStop not enabled !");
                                }
                            }
                    }
                }
            });


            // // Listen for pong messages to reset the isAlive flag
            // ws.on('pong', () => {
            //     ws.isAlive = true;
            // });

            // // Set up the ping interval
            // const interval = setInterval(() => {
            //     // Terminate the connection if the isAlive flag is false
            //     if (ws.isAlive === false) {
            //         console.log('Terminating due to no pong response');
            //         return ws.terminate();
            //     }

            //     // Set the isAlive flag to false and send a ping
            //     ws.isAlive = false;
            //     ws.ping();
            // }, PING_INTERVAL);

            wss.on('close', (code, reason) => {
                if (code === 1001) {
                    console.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed from browser side`);
                    logger.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed from browser side`);
                } else {
                    console.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed with code ${code} and reason: ${reason}`);
                    logger.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed with code ${code} and reason: ${reason}`);
                }
                ClientConnections.delete(ws);
                // Attempt to reconnect after a delay
                setTimeout(() => {
                    connectWebSocket();
                }, 1000);
                // clearInterval(interval);

            });

            // Add a global unhandled rejection handler
            process.on('unhandledRejection', (reason, promise) => {
                console.log('Unhandled Rejection at:', promise, 'reason:', reason);
                logger.info('Unhandled Rejection at:', promise, 'reason:', reason);
            });

            // Event listener for WebSocket errors
            ws.on('error', (error) => {
                try {
                    if (error.code === 'WS_ERR_EXPECTED_MASK') {
                        // Handle the specific error
                        console.log(`WebSocket error ${uniqueIdentifier}: MASK bit must be set.`);
                        logger.error(`WebSocket error ${uniqueIdentifier}: MASK bit must be set.`);
                        // Attempt to reconnect after a delay
                        setTimeout(() => {
                            connectWebSocket();
                        }, 1000);
                    } else {
                        // Handle other WebSocket errors
                        console.log(`WebSocket error ${uniqueIdentifier}: ${error.message}`);
                        console.error(error.stack);
                        logger.error(`WebSocket error ${uniqueIdentifier}: ${error.message}`);
                    }
                } catch (err) {
                    // Log the error from the catch block
                    console.error(`Error in WebSocket error handler: ${err.message}`);
                    logger.error(`Error in WebSocket error handler: ${err.message}`);
                    console.error(error.stack);
                }
            });

        }

        async function getUsername(chargerID) {
            try {
                const db = await connectToDatabase();
                const evDetailsCollection = db.collection('charger_details');
                const chargerDetails = await evDetailsCollection.findOne({ ChargerID: chargerID });
                if (!chargerDetails) {
                    console.log('getUsername - Charger ID not found in the database');
                }
                const username = chargerDetails.current_or_active_user;
                return username;
            } catch (error) {
                console.error('Error getting username:', error);
            }
        }

        // Initial websocket connection
        connectWebSocket();
        // Start ping-pong mechanism
        // startPing(ws);

    });

    const broadcastMessage = (DeviceID, message, sender) => {
        const data = {
            DeviceID,
            message,
        };

        const jsonMessage = JSON.stringify(data);

        // Iterate over each client connected to another_wss and send the message
        ClientWss.clients.forEach(client => {
            // Check if the client is not the sender and its state is open
            if (client !== sender && client.readyState === WebSocket.OPEN) {
                client.send(jsonMessage, (error) => {
                    if (error) {
                        console.log(`Error sending message to client: ${error.message}`);
                        // Handle error as needed
                    }
                });
            }
        });

    };
};

module.exports = { handleWebSocketConnection };