const logger = require('./logger');
const { connectToDatabase } = require('./db');
const { generateRandomTransactionId, SaveChargerStatus, updateTime, updateCurrentOrActiveUserToNull,getAutostop,getIpAndupdateUser , updateChargerDetails, checkChargerIdInDatabase, checkChargerTagId, checkAuthorization, SaveChargerValue, UpdateInUse} = require('./functions');

const PING_INTERVAL = 60000; // 30 seconds ping interval

connectToDatabase();


const getUniqueIdentifierFromRequest = async (request, ws) => {
    const urlParts = request.url.split('/');
    const firstPart = urlParts[1];
    const secondPart = urlParts[2];
    const thirdPart = urlParts[3];

    const identifier = urlParts.pop();
    if ((firstPart === 'EvPower' && secondPart === 'websocket' && thirdPart === 'CentralSystemService') ||
        (firstPart === 'steve' && secondPart === 'websocket' && thirdPart === 'CentralSystemService')) {
        
        // Validate the request method is GET
        if (request.method !== 'GET') {
            ws.terminate();
            console.log(`Connection terminated: Invalid method - ${request.method}`);
            return;
        }

        // Validate the URL contains 'EvPower' or 'steve'
        if (!request.url.includes(firstPart)) {
            ws.terminate();
            console.log(`Connection terminated: URL does not contain '${firstPart}' - ${request.url}`);
            return;
        }

        // Validate required headers
        const headers = request.headers;
        if (headers['connection'] !== 'Upgrade' || headers['upgrade'] !== 'websocket') {
            ws.terminate();
            console.log(`Connection terminated: Missing required headers`);
            return;
        }

        // Convert identifier to string
        const chargerId = identifier.toString();
        const chargerExists = await checkChargerIdInDatabase(chargerId);
        if (!chargerExists) {
            ws.terminate();
            console.log(`Connection terminated: Charger ID ${chargerId} not found in the database`);
            return;
        }
        // If charger exists, return the identifier
        return identifier;
    } else {
        ws.terminate();
        console.log(`Connection terminated: Invalid header - ${urlParts}`);
    }
};


const handleWebSocketConnection = (WebSocket, wss, ClientWss, wsConnections, ClientConnections, clients, sessionFlags, charging_states, startedChargingSet, chargingSessionID, meterValuesMap) => {
    wss.on('connection', async (ws, req) => {
        // Initialize the isAlive property to true
        ws.isAlive = true;
        const uniqueIdentifier = await getUniqueIdentifierFromRequest(req, ws); // Await here
        if (!uniqueIdentifier) {
            return; // Exit if no valid unique identifier is found
        }

        const clientIpAddress = req.connection.remoteAddress;
        let timeoutId;

        const previousResults = new Map(); //updateTime - store previous result value
        const currentVal = new Map(); //updateTime - store current result value

        previousResults.set(uniqueIdentifier, null);
        wsConnections.set(uniqueIdentifier, ws);
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
                    await db.collection('charger_status').updateOne({ charger_id: uniqueIdentifier }, { $set: { client_ip: clientIpAddress } }, function(err, rslt) {
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
 

        // Function to handle WebSocket messages
        function connectWebSocket() {
            // Event listener for messages from the client
            ws.on('message', async (message) => {
                // console.log(message)
                // console.log((message.toString()));
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

                if (requestData[0] === 3 && requestData[2].configurationKey) {
                    const httpResponse = OCPPResponseMap.get(ws);
                    if (httpResponse) {
                        httpResponse.setHeader('Content-Type', 'application/json');
                        httpResponse.end(JSON.stringify(requestData));
                        OCPPResponseMap.delete(ws);
                    }
                }

                if (requestData[0] === 3 && requestData[2].status) {
                    const httpResponse = OCPPResponseMap.get(ws);
                    if (httpResponse) {
                        httpResponse.setHeader('Content-Type', 'application/json');
                        httpResponse.end(JSON.stringify(requestData));
                        OCPPResponseMap.delete(ws);
                    }
                }

                if (requestData[0] === 2 && requestData[2] === 'FirmwareStatusNotification') {
                    const httpResponse = OCPPResponseMap.get(ws);
                    if (httpResponse) {
                        httpResponse.setHeader('Content-Type', 'application/json');
                        httpResponse.end(JSON.stringify(requestData));
                        OCPPResponseMap.delete(ws);
                    }
                }

                if (Array.isArray(requestData) && requestData.length >= 4) {
                    const requestType = requestData[0];
                    const Identifier = requestData[1];
                    const requestName = requestData[2];

                    if (requestData[2] === "BootNotification") {//BootNotification
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
                
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const response = [3, requestData[1], {
                            "currentTime": new Date().toISOString(),
                            "interval": 14400
                        }];
                
                        if (errors.length === 0) {
                            // All checks passed, update the database
                            const updateData = {
                                vendor: data.chargePointVendor,
                                model: data.chargePointModel,
                                type: data.meterType,
                                modified_date: new Date()
                            };
                
                            const updateResult = await updateChargerDetails(uniqueIdentifier, updateData);
                            
                            if (updateResult) {
                                console.log(`ChargerID: ${uniqueIdentifier} - Updated charger details successfully`);
                                logger.info(`ChargerID: ${uniqueIdentifier} - Updated charger details successfully`);
                            } else {
                                console.error(`ChargerID: ${uniqueIdentifier} - Failed to update charger details`);
                                logger.error(`ChargerID: ${uniqueIdentifier} - Failed to update charger details`);
                            }
                
                            // Check the tag_id status
                            const status = await checkChargerTagId(uniqueIdentifier);
                            response.push({ "status": status });
                        } else {
                            // Validation failed, send "Rejected" response
                            response.push({ "status": "Rejected", "errors": errors }); // Add errors to the response for debugging
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
                    
                                    // console.log(`Field: ${field}, Expected Type: ${property.type}, Actual Type: ${typeof data[field]}`);
                    
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
                    
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const response = [3, requestData[1], {}];
                    
                        if (errors.length === 0) {
                            sendTo.send(JSON.stringify(response));
                    
                            const status = requestData[3].status;
                            const errorCode = requestData[3].errorCode;
                            const vendorErrorCode = requestData[3].vendorErrorCode;
                            const timestamp = requestData[3].timestamp;
                
                            if (status != undefined) {
                                const keyValPair = {};
                                keyValPair.charger_id = uniqueIdentifier;
                                keyValPair.charger_status = status;
                                keyValPair.timestamp = new Date(timestamp);
                                keyValPair.client_ip = clientIpAddress;
                                if(errorCode !== 'InternalError'){
                                    keyValPair.error_code = errorCode;
                                }else{
                                    keyValPair.error_code = vendorErrorCode;
                                }
                                keyValPair.created_date = new Date();
                                keyValPair.modified_date = null;

                                const Chargerstatus = JSON.stringify(keyValPair);
                                await SaveChargerStatus(Chargerstatus);
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
                                startedChargingSet.set(uniqueIdentifier);
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
                

                        } else {
                            response[2] = { errors: errors };
                            sendTo.send(JSON.stringify(response));
                        }
                    } else if (requestType === 2 && requestName === "Heartbeat") {//Heartbeat
                        const sendTo = wsConnections.get(uniqueIdentifier);
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
                    } else if (requestType === 2 && requestName === "Authorize") {//Authorize
                        const data = requestData[3]; 
                        // Define the schema
                        const schema = {
                            properties: {
                                idTag: { type: "string", maxLength: 20 },
                            },
                            required: ["idTag"]
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
                
                        const idTag = requestData[3].idTag;
                        const { status, expiryDate } = await checkAuthorization(uniqueIdentifier, idTag);
                        const sendTo = wsConnections.get(uniqueIdentifier);
                
                        if (errors.length === 0) {
                            let response;
                            if(status === "Invalid"){
                                response = [3, Identifier, 
                                    { "idTagInfo": { "status": status } }];
                            }else{
                                response = [3, Identifier, 
                                    { "idTagInfo": { "status": status,
                                                    "expiryDate": expiryDate || new Date().toISOString() } }];
                            }
                            
                            sendTo.send(JSON.stringify(response));
                        } else {
                            const response = [3, Identifier, 
                                { "idTagInfo": { "status": "Invalid" } }];
                            sendTo.send(JSON.stringify(response));
                            return;
                        }

                    } else if (requestType === 2 && requestName === "StartTransaction") {//StartTransaction
                        const data = requestData[3]; // Extract the data for validation
                    
                        // Define schema
                        const startTransactionRequestSchema = {
                            properties: {
                                connectorId: { type: "integer" },
                                idTag: { type: "string", maxLength: 20 },
                                meterStart: { type: "integer" },
                                reservationId: { type: "integer" },
                                timestamp: { type: "string", format: "date-time" }
                            },
                            required: ["connectorId", "idTag", "meterStart", "timestamp"]
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
                    
                                    // console.log(`Field: ${field}, Expected Type: ${property.type}, Actual Type: ${typeof data[field]}`);
                    
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
                    
                        let transId;
                        const generatedTransactionId = generateRandomTransactionId();
                        const idTag = requestData[3].idTag;
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const requestErrors = validate(data, startTransactionRequestSchema);
                    
                        if (requestErrors.length === 0) {
                            const { status, expiryDate } = await checkAuthorization(uniqueIdentifier, idTag);
                            await db.collection('charger_details').findOneAndUpdate({ charger_id: uniqueIdentifier }, { $set: { transaction_id: generatedTransactionId } }, { returnDocument: 'after' })
                            .then(async updatedDocument => {
                                transId = updatedDocument.transaction_id;
                    
                                const response = [3, Identifier, {
                                    "transactionId": transId,
                                    "idTagInfo": {
                                        "expiryDate": expiryDate || new Date().toISOString(),
                                        "parentIdTag": "PARENT12345",
                                        "status": status
                                    }
                                }];
                                sendTo.send(JSON.stringify(response));
                                    await UpdateInUse(idTag ,true);
                                isChargerStated = true;
                            }).catch(error => {
                                isChargerStated = false;
                                console.error(`${uniqueIdentifier}: Error executing while updating transactionId:`, error);
                                logger.error(`${uniqueIdentifier}: Error executing while updating transactionId:`, error);
                            });
                        } else {
                            console.error('Invalid StartTransactionRequest frame:', requestErrors);
                            const response = [3, Identifier, {
                                "idTagInfo": {
                                    "status": "Invalid",
                                    "errors": requestErrors 
                                }
                            }];
                            sendTo.send(JSON.stringify(response));
                            return;
                        }
                    } else if (requestType === 2 && requestName === "MeterValues") {
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const response = [3, requestData[1], {}];
                        sendTo.send(JSON.stringify(response));
                    } else if (requestType === 2 && requestName === "StopTransaction") {//StopTransaction
                        const data = requestData[3]; // Extract the data for validation
                        // Define schema
                        const stopTransactionRequestSchema = {
                            properties: {
                                idTag: { type: "string", maxLength: 20 },
                                meterStop: { type: "integer" },
                                timestamp: { type: "string", format: "date-time" },
                                transactionId: { type: "integer" },
                                reason: {
                                    type: "string",
                                    enum: [
                                        "EmergencyStop", "EVDisconnected", "HardReset", "Local", "Other",
                                        "PowerLoss", "Reboot", "Remote", "SoftReset", "UnlockCommand", "DeAuthorized"
                                    ]
                                },
                                transactionData: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            timestamp: { type: "string", format: "date-time" },
                                            sampledValue: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        value: { type: "string" },
                                                        context: {
                                                            type: "string",
                                                            enum: [
                                                                "Interruption.Begin", "Interruption.End", "Sample.Clock", "Sample.Periodic",
                                                                "Transaction.Begin", "Transaction.End", "Trigger", "Other"
                                                            ]
                                                        },
                                                        format: {
                                                            type: "string",
                                                            enum: ["Raw", "SignedData"]
                                                        },
                                                        measurand: {
                                                            type: "string",
                                                            enum: [
                                                                "Energy.Active.Export.Register", "Energy.Active.Import.Register", "Energy.Reactive.Export.Register",
                                                                "Energy.Reactive.Import.Register", "Energy.Active.Export.Interval", "Energy.Active.Import.Interval",
                                                                "Energy.Reactive.Export.Interval", "Energy.Reactive.Import.Interval", "Power.Active.Export",
                                                                "Power.Active.Import", "Power.Offered", "Power.Reactive.Export", "Power.Reactive.Import",
                                                                "Power.Factor", "Current.Import", "Current.Export", "Current.Offered", "Voltage",
                                                                "Frequency", "Temperature", "SoC", "RPM"
                                                            ]
                                                        },
                                                        phase: {
                                                            type: "string",
                                                            enum: [
                                                                "L1", "L2", "L3", "N", "L1-N", "L2-N", "L3-N", "L1-L2", "L2-L3", "L3-L1"
                                                            ]
                                                        },
                                                        location: {
                                                            type: "string",
                                                            enum: ["Cable", "EV", "Inlet", "Outlet", "Body"]
                                                        },
                                                        unit: {
                                                            type: "string",
                                                            enum: [
                                                                "Wh", "kWh", "varh", "kvarh", "W", "kW", "VA", "kVA", "var", "kvar",
                                                                "A", "V", "K", "Celcius", "Fahrenheit", "Percent"
                                                            ]
                                                        }
                                                    },
                                                    required: ["value"]
                                                }
                                            }
                                        },
                                        required: ["timestamp", "sampledValue"]
                                    }
                                }
                            },
                            required: ["transactionId", "timestamp", "meterStop"]
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
                                    const fieldType = typeof data[field];

                                    if (property.type) {
                                        if (property.type === 'integer' && !Number.isInteger(data[field])) {
                                            errors.push(`Invalid type for field: ${field}`);
                                        } else if (property.type === 'number' && fieldType !== 'number') {
                                            errors.push(`Invalid type for field: ${field}`);
                                        } else if (property.type !== 'integer' && property.type !== 'number' && fieldType !== property.type) {
                                            errors.push(`Invalid type for field: ${field}`);
                                        }
                                    }

                                    if (property.maxLength && data[field].length > property.maxLength) {
                                        errors.push(`Field exceeds maxLength: ${field}`);
                                    }
                                    if (property.enum && !property.enum.includes(data[field])) {
                                        errors.push(`Invalid value for field: ${field}`);
                                    }
                                    if (property.format === "date-time" && isNaN(Date.parse(data[field]))) {
                                        errors.push(`Invalid date-time format for field: ${field}`);
                                    }
                                    if (field === "transactionData") {
                                        data[field].forEach((item, index) => {
                                            const itemErrors = validate(item, schema.properties[field].items);
                                            if (itemErrors.length > 0) {
                                                errors.push(`Invalid item at index ${index} in transactionData: ${itemErrors.join(", ")}`);
                                            }
                                        });
                                    }
                                }
                            });
                                            
                            return errors;
                        }
                        const idTag = requestData[3].idTag;
                        const { status, expiryDate } = await checkAuthorization(uniqueIdentifier, idTag);
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const requestErrors = validate(data, stopTransactionRequestSchema);
                        let response;
                        if (requestErrors.length === 0) {
                            response = [3, Identifier, {
                                "idTagInfo": {
                                    "expiryDate":  expiryDate ||new Date().toISOString() ,
                                    "parentIdTag": "PARENT12345",
                                    "status": status
                                }}
                            ]; 
                        } else {
                            console.error('Invalid StopTransactionRequest frame:', requestErrors);
                            response = [3, Identifier, {
                                "idTagInfo": {
                                    "status": "Invalid",
                                    "errors": requestErrors 
                                }}
                            ]; 
                        }
                        sendTo.send(JSON.stringify(response));
                        await UpdateInUse(idTag ,false);           
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

            // Attach the close event to the ws object
            ws.on('close', (code, reason) => {
                if (code === 1001) {
                    console.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed from browser side`);
                    logger.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed from browser side`);
                } else {
                    console.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed with code ${code} and reason: ${reason}`);
                    logger.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed with code ${code} and reason: ${reason}`);
                }
                ClientConnections.delete(ws);
                // clearInterval(interval); // Clear the interval when the connection is closed
                // Attempt to reconnect after a delay
                setTimeout(() => {
                    connectWebSocket();
                }, 1000);
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


        // Initial websocket connection
        connectWebSocket();
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
