const logger = require('./logger');
const { connectToDatabase } = require('./db');
const {
    generateRandomTransactionId, SaveChargerStatus, updateTime, updateCurrentOrActiveUserToNull, handleChargingSession,
    getUsername, updateChargerDetails, checkChargerIdInDatabase, checkChargerTagId, checkAuthorization, calculateDifference,
    UpdateInUse, getAutostop, captureMetervalues, autostop_unit, autostop_price, insertSocketGunConfig, NullTagIDInStatus
} = require('./functions');
const Chargercontrollers = require("./src/ChargingSession/controllers.js");

const PING_INTERVAL = 60000; // 60 seconds ping interval

connectToDatabase();

const getUniqueIdentifierFromRequest = async (request, ws) => {
    const urlParts = request.url.split('/');
    const firstPart = urlParts[1];
    const secondPart = urlParts[2];
    const thirdPart = urlParts[3];
    const identifier = urlParts.pop();

    if ((firstPart === 'EvPower' && secondPart === 'websocket' && thirdPart === 'CentralSystemService') ||
        (firstPart === 'steve' && secondPart === 'websocket' && thirdPart === 'CentralSystemService') ||
        (firstPart === 'OCPPJ')) {
        
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

const handleWebSocketConnection = (WebSocket, wss, ClientWss, wsConnections, ClientConnections, clients, OCPPResponseMap, meterValuesMap, sessionFlags, charging_states, startedChargingSet, chargingSessionID) => {
    wss.on('connection', async (ws, req) => {
        ws.isAlive = true;
        const uniqueIdentifier = await getUniqueIdentifierFromRequest(req, ws); // Await here
        if (!uniqueIdentifier) {
            return; // Exit if no valid unique identifier is found
        }

        const clientIpAddress = req.connection.remoteAddress;
        let timeoutId;
        let GenerateChargingSessionID;
        let StartTimestamp = null;
        let StopTimestamp = null;
        let timestamp;
        let autoStopTimer; // Initialize a variable to hold the timeout reference

        const previousResults = new Map(); //updateTime - store previous result value
        const currentVal = new Map(); //updateTime - store current result value

        previousResults.set(uniqueIdentifier, null);
        wsConnections.set(uniqueIdentifier, ws);
        ClientConnections.add(ws);
        clients.set(ws, uniqueIdentifier);

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

            clients.set(ws, uniqueIdentifier);
        } else {
            console.log(`WebSocket connection established from browser`);
            logger.info(`WebSocket connection established from browser`);
        }


        const getMeterValues = (key) => {
            if (!meterValuesMap.has(key)) {
                meterValuesMap.set(key, {});
            }
            return meterValuesMap.get(key);
        };

        const deleteMeterValues = (key) => {
            if (meterValuesMap.has(key)) {
                meterValuesMap.delete(key);
            }
        };

        // Function to handle WebSocket messages
        function connectWebSocket() {
            // Event listener for messages from the client
            ws.on('message', async (message) => {
                const requestData = JSON.parse(message);
                let WS_MSG = `ChargerID: ${uniqueIdentifier} - ReceivedMessage: ${message}`;
                logger.info(WS_MSG);
                console.log(WS_MSG);

                broadcastMessage(uniqueIdentifier, requestData, ws);

                const currentDate = new Date();
                const formattedDate = currentDate.toISOString();

                if (requestData[0] === 3 && requestData[2].action === 'DataTransfer') {
                    const httpResponse = OCPPResponseMap.get(ws);
                    if (httpResponse) {
                        httpResponse.setHeader('Content-Type', 'application/json');
                        httpResponse.end(JSON.stringify(requestData));
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
                    const connectorId = requestData[3].connectorId; // Get the connector ID from the request                

                    const key = `${uniqueIdentifier}_${connectorId}`;

                    if (requestName === "BootNotification") {
                        const data = requestData[3]; // Correctly reference the data object
                        const schema = {
                            properties: {
                                chargePointVendor: { type: "string", maxLength: 20 },
                                chargePointModel: { type: "string", maxLength: 50 },
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
                    
                        function validateChargePointModel(model) {
                            const errors = [];
                            const pattern = /^(.*? - )([1-9][SG]){1,}$/;
                    
                            if (!pattern.test(model)) {
                                errors.push(`Invalid chargePointModel format: ${model}`);
                            }
                    
                            return errors;
                        }
                    
                        const errors = validate(data, schema).concat(validateChargePointModel(data.chargePointModel));

                        const sendTo =  wsConnections.get(uniqueIdentifier);
                        const response = [3, requestData[1], {
                            "currentTime": new Date().toISOString(),
                            "interval": 14400
                        }];
                    
                        if (errors.length === 0) {
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
                    
                                const insertSocketGun= await insertSocketGunConfig(uniqueIdentifier, data.chargePointModel);
                                if (insertSocketGun) {
                                    console.log(`ChargerID: ${uniqueIdentifier} - insertSocketGunConfig - Updated charger details successfully`);
                                    logger.info(`ChargerID: ${uniqueIdentifier} - insertSocketGunConfig - Updated charger details successfully`);
                            
                                    } else {
                                        console.error(`ChargerID: ${uniqueIdentifier} - insertSocketGunConfig - Failed to update charger details`);
                                        logger.error(`ChargerID: ${uniqueIdentifier} - insertSocketGunConfig -- Failed to update charger details`);
                                    }
                            } else {
                                console.error(`ChargerID: ${uniqueIdentifier} - Failed to update charger details`);
                                logger.error(`ChargerID: ${uniqueIdentifier} - Failed to update charger details`);
                            }
                    
                            const status = await checkChargerTagId(uniqueIdentifier, connectorId);
                            response.push({ "status": status });
                        } else {
                            console.log("status: Rejected")
                            response.push({ "status": "Rejected", "errors": errors });
                        }
                    
                        sendTo.send(JSON.stringify(response));
                    } else if (requestType === 2 && requestName === "StatusNotification") {
                        const data = requestData[3]; // Assuming the actual data is in requestData[3]
                    
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
                    
                        function validate(data, schema) {
                            const errors = [];
                            schema.required.forEach(field => {
                                if (!data.hasOwnProperty(field)) {
                                    errors.push(`Missing required field: ${field}`);
                                }
                            });
                    
                            Object.keys(schema.properties).forEach(field => {
                                if (data.hasOwnProperty(field)) {
                                    const property = schema.properties[field];
                    
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
                            const connectorId = requestData[3].connectorId;
                            timestamp = requestData[3].timestamp;
                            const key = `${uniqueIdentifier}_${connectorId}`; // Create a composite key
                            if (status != undefined) {
                                // Fetch the connector type from socket_gun_config
                                const socketGunConfig = await db.collection('socket_gun_config').findOne({ charger_id: uniqueIdentifier});
                                const connectorIdTypeField = `connector_${connectorId}_type`;
                                const connectorTypeValue = socketGunConfig[connectorIdTypeField];

                                const keyValPair = {};
                                keyValPair.charger_id = uniqueIdentifier;
                                keyValPair.connector_id = connectorId;
                                keyValPair.connector_type = connectorTypeValue; 
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
                                await SaveChargerStatus(Chargerstatus, connectorId);
                            }
                    
                            if (status === 'Available') {
                                timeoutId = setTimeout(async () => {
                                    const result = await updateCurrentOrActiveUserToNull(uniqueIdentifier,connectorId);
                                    if (result === true) {
                                        console.log(`ChargerID ${uniqueIdentifier} - End charging session is updated successfully.`);
                                    } else {
                                        console.log(`ChargerID ${uniqueIdentifier} - End charging session is not updated.`);
                                    }
                                }, 50000); // 50 seconds delay 
                                deleteMeterValues(key);
                                await NullTagIDInStatus(uniqueIdentifier, connectorId);
                            } else {
                                if (timeoutId !== undefined) {
                                    clearTimeout(timeoutId);
                                    timeoutId = undefined; // Reset the timeout reference
                                }
                            }
                    
                    
                            if (status === 'Preparing') {
                                sessionFlags.set(key, 0);
                                startedChargingSet.delete(key);
                                charging_states.set(key, false);
                                deleteMeterValues(key);
                                await NullTagIDInStatus(uniqueIdentifier, connectorId);
                            }
                    
                            if (status == 'Charging' && !startedChargingSet.has(key)) {
                                sessionFlags.set(key, 1);
                                charging_states.set(key, true);
                                StartTimestamp = timestamp;
                                startedChargingSet.add(key);
                                GenerateChargingSessionID = generateRandomTransactionId();
                                chargingSessionID.set(key, GenerateChargingSessionID);
                            }

                            if ((status === 'SuspendedEV' || status === 'Faulted') && (charging_states.get(key) == true)) {
                                sessionFlags.set(key, 1);
                                StopTimestamp = timestamp;
                                charging_states.set(key, false);
                                startedChargingSet.delete(key);
                                deleteMeterValues(key);
                            }
                
                        } else {
                            response[2] = { errors: errors };
                            sendTo.send(JSON.stringify(response));
                        }
                    } else if (requestType === 2 && requestName === "Heartbeat") {
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const response = [3, Identifier, { "currentTime": formattedDate }];
                        sendTo.send(JSON.stringify(response));
                        const result = await updateTime(uniqueIdentifier, undefined);
                        currentVal.set(uniqueIdentifier, result);
                        if (currentVal.get(uniqueIdentifier) === true) {
                            if (previousResults.get(uniqueIdentifier) === false) {
                                sendTo.terminate();
                                console.log(`ChargerID - ${uniqueIdentifier} terminated and try to reconnect !`);
                            }
                        }
                        previousResults.set(uniqueIdentifier, result);
                    } else if (requestType === 2 && requestName === "Authorize") {
                        const data = requestData[3]; 
                        const schema = {
                            properties: {
                                idTag: { type: "string", maxLength: 20 },
                            },
                            required: ["idTag"]
                        };
                
                        function validate(data, schema) {
                            const errors = [];
                
                            schema.required.forEach(field => {
                                if (!data.hasOwnProperty(field)) {
                                    errors.push(`Missing required field: ${field}`);
                                }
                            });
                
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
                        const { status, expiryDate, connectorId } = await checkAuthorization(uniqueIdentifier, idTag);
                        console.log("AuthStatus:" , status);
                        const sendTo = wsConnections.get(uniqueIdentifier);
                
                        if (errors.length === 0) {
                            let response;
                            if(status === "Invalid"){
                                response = [3, Identifier, 
                                    { "idTagInfo": { "status": status } }];
                            }else{
                                response = [3, Identifier, 
                                    { "idTagInfo": { "status": status,
                                                    "expiryDate": expiryDate || new Date().toISOString()} }];
                                try {
                                    if (status) {
                                        let AuthData = [
                                            2,
                                            "lyw5bpqwo7ehtwzi",
                                            "StatusNotification",
                                            {
                                                connectorId: connectorId,
                                                errorCode: "NoError",
                                                TagIDStatus: status, 
                                                timestamp: new Date().toISOString()
                                            }
                                        ];
                                        await broadcastMessage(uniqueIdentifier, AuthData, ws);
                                        console.log('AuthData successfully broadcasted:');
                                    }
                                } catch (error) {
                                    console.error('Error broadcasting AuthData:', error);
                                } 
                            }
                            
                            sendTo.send(JSON.stringify(response));
                        } else {
                            const response = [3, Identifier, 
                                { "idTagInfo": { "status": "Invalid" } }];
                            sendTo.send(JSON.stringify(response));
                            return;
                        }
                    } else if (requestType === 2 && requestName === "StartTransaction") {
                        const data = requestData[3];
                        const startTransactionRequestSchema = {
                            properties: {
                                connectorId: { type: "integer" },
                                idTag: { type: "string", maxLength: 20 },
                                meterStart: { type: "number" },
                                reservationId: { type: "integer" },
                                timestamp: { type: "string", format: "date-time" }
                            },
                            required: ["connectorId", "idTag", "meterStart", "timestamp"]
                        };
                    
                        function validate(data, schema) {
                            const errors = [];
                    
                            schema.required.forEach(field => {
                                if (!data.hasOwnProperty(field)) {
                                    errors.push(`Missing required field: ${field}`);
                                }
                            });
                    
                            Object.keys(schema.properties).forEach(field => {
                                if (data.hasOwnProperty(field)) {
                                    const property = schema.properties[field];
                    
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
                        let update;
                        let isChargerStarted = false;
                        const generatedTransactionId = generateRandomTransactionId();
                        console.log(generatedTransactionId)
                        const idTag = requestData[3].idTag;
                        const connectorId = requestData[3].connectorId;
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const requestErrors = validate(data, startTransactionRequestSchema);

    
                        if (requestErrors.length === 0) {
                            const { status, expiryDate } = await checkAuthorization(uniqueIdentifier, idTag);
                            const updateField = `transaction_id_for_connector_${connectorId}`;

                            try {
                                 // Generate the field name for the tag_id based on connector_id
                                const connectorTagIdField = `tag_id_for_connector_${connectorId}`;
                                const connectorTagIdInUseField = `tag_id_for_connector_${connectorId}_in_use`;


                                const result = await db.collection('charger_details').findOneAndUpdate(
                                    { charger_id: uniqueIdentifier },
                                    { $set: { [updateField]: generatedTransactionId, 
                                                [connectorTagIdInUseField]: true,
                                                [connectorTagIdField]:  idTag
                                    } },
                                    { returnDocument: 'after' }
                                );
                                update = result;
                                if (update) {
                                    transId = update[updateField];
                    
                                    const response = [3, Identifier, {
                                        "transactionId": transId,
                                        "idTagInfo": {
                                            // "expiryDate": expiryDate || new Date().toISOString(),
                                            "parentIdTag": "PARENT12345",
                                            "status": status
                                        }
                                    }];
                    
                                    sendTo.send(JSON.stringify(response));


                                    if (status === "Accepted") {
                                        isChargerStarted = true;
                                    }
                    
                                    if (isChargerStarted) {
                                        const user = await getUsername(uniqueIdentifier, connectorId, idTag);
                                        const autostop = await getAutostop(user);
                    
                                        if (autostop.time_value && autostop.isTimeChecked) {
                                            const autostopTimeInSeconds = autostop.time_value * 60 * 1000; // Convert minutes to milliseconds
                    
                                            // Start the timeout and store the reference
                                            autoStopTimer = setTimeout(async () => {
                                                console.log('Calling stop route after autostop_time for user:', user);
                                                const result = await Chargercontrollers.chargerStopCall(uniqueIdentifier, connectorId);
                                                if (result === true) {
                                                    console.log(`AutoStop timer: Charger Stopped!`);
                                                } else {
                                                    console.log(`Error: ${result}`);
                                                }
                                            }, autostopTimeInSeconds);
                                        } else {
                                            console.error("AutoStop not enabled or configured!");
                                        }
                                    }
                                } else {
                                    throw new Error('Update operation failed. No document was updated.');
                                }
                            } catch (error) {
                                isChargerStarted = false;
                                console.error(`${uniqueIdentifier}: Error executing while updating transactionId:`, error);
                                logger.error(`${uniqueIdentifier}: Error executing while updating transactionId:`, error);
                            }
                        } else {
                            console.error('Invalid StartTransactionRequest frame:', requestErrors);
                            const response = [3, Identifier, {
                                "idTagInfo": {
                                    "status": "Invalid",
                                    "errors": requestErrors 
                                }
                            }];
                            sendTo.send(JSON.stringify(response));
                            isChargerStarted = false;
                            return;
                        }
                    } else if (requestType === 2 && requestName === "MeterValues") {
                        const data = requestData[3];
                    
                        let autostopSettings;
                        const connectorId = requestData[3].connectorId;
                        const key = `${uniqueIdentifier}_${connectorId}`; // Create a composite key
                        const UniqueChargingSessionId = chargingSessionID.get(key); // Use the current session ID
                    
                        const meterValuesSchema = {
                            properties: {
                                connectorId: { type: "integer" },
                                transactionId: { type: "integer" },
                                meterValue: {
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
                                                            additionalProperties: false,
                                                            enum: [
                                                                "Interruption.Begin", "Interruption.End", "Sample.Clock", "Sample.Periodic",
                                                                "Transaction.Begin", "Transaction.End", "Trigger", "Other"
                                                            ]
                                                        },
                                                        format: {
                                                            type: "string",
                                                            additionalProperties: false,
                                                            enum: ["Raw", "SignedData"]
                                                        },
                                                        measurand: {
                                                            type: "string",
                                                            additionalProperties: false,
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
                                                            additionalProperties: false,
                                                            enum: [
                                                                "L1", "L2", "L3", "N", "L1-N", "L2-N", "L3-N", "L1-L2", "L2-L3", "L3-L1"
                                                            ]
                                                        },
                                                        location: {
                                                            type: "string",
                                                            additionalProperties: false,
                                                            enum: ["Cable", "EV", "Inlet", "Outlet", "Body"]
                                                        },
                                                        unit: {
                                                            type: "string",
                                                            additionalProperties: false,
                                                            enum: [
                                                                "Wh", "kWh", "varh", "kvarh", "W", "kW", "VA", "kVA", "var", "kvar",
                                                                "A", "V", "K", "Celcius", "Celsius", "Fahrenheit", "Percent"
                                                            ]
                                                        }
                                                    },
                                                    additionalProperties: false,
                                                    required: ["value"]
                                                }
                                            }
                                        },
                                        additionalProperties: false,
                                        required: ["timestamp", "sampledValue"]
                                    }
                                }
                            },
                            additionalProperties: false,
                            required: ["connectorId", "meterValue"]
                        };
                    
                        function validateSchema(data, schema) {
                            const errors = [];
                    
                            if (!data) {
                                return ["Data is undefined or null"];
                            }
                    
                            if (schema.required) {
                                schema.required.forEach(field => {
                                    if (!data.hasOwnProperty(field)) {
                                        errors.push(`Missing required field: ${field}`);
                                    }
                                });
                            }
                    
                            Object.keys(schema.properties).forEach(field => {
                                if (data.hasOwnProperty(field)) {
                                    const property = schema.properties[field];
                    
                                    if (property.type === "integer" && !Number.isInteger(data[field])) {
                                        errors.push(`Invalid type for field: ${field}. Expected integer, got ${typeof data[field]}`);
                                    } else if (property.type === "array" && Array.isArray(data[field])) {
                                        data[field].forEach((item, index) => {
                                            errors.push(...validateSchema(item, property.items).map(e => `${field}[${index}].${e}`));
                                        });
                                    } else if (property.type === "object" && typeof data[field] === 'object') {
                                        errors.push(...validateSchema(data[field], property).map(e => `${field}.${e}`));
                                    } else if (property.type !== "integer" && typeof data[field] !== property.type) {
                                        errors.push(`Invalid type for field: ${field}. Expected ${property.type}, got ${typeof data[field]}`);
                                    }
                    
                                    if (property.enum && !property.enum.includes(data[field])) {
                                        errors.push(`Invalid value for field: ${field}`);
                                    }
                                }
                            });
                    
                            return errors;
                        }
                    
                        const requestErrors = validateSchema(data, meterValuesSchema);
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const meterValues = getMeterValues(key);
                    
                        let response;
                        if (requestErrors.length === 0) {
                            response = [3, Identifier, {}];
                    
                            if (!meterValues.firstMeterValues && !meterValues.connectorId) {
                                console.log('unit/price autostop - new session');
                                const user = await getUsername(uniqueIdentifier, connectorId);
                                autostopSettings = await getAutostop(user);
                    
                                meterValues.autostopSettings = autostopSettings;
                            } else {
                                console.log('unit/price autostop - session updating');
                                autostopSettings = meterValues.autostopSettings;
                            }
                    
                            if (!meterValues.firstMeterValues && !meterValues.connectorId) {
                                meterValues.connectorId = connectorId;
                                meterValues.firstMeterValues = await captureMetervalues(Identifier, requestData, uniqueIdentifier, clientIpAddress, UniqueChargingSessionId, connectorId);
                                console.log(`First MeterValues for ${uniqueIdentifier} for Connector ${connectorId}: ${meterValues.firstMeterValues}`);
                                if (autostopSettings.isUnitChecked) {
                                    await autostop_unit(meterValues.firstMeterValues, meterValues.lastMeterValues, autostopSettings, uniqueIdentifier, connectorId);
                                } else if (autostopSettings.isPriceChecked) {
                                    await autostop_price(meterValues.firstMeterValues, meterValues.lastMeterValues, autostopSettings, uniqueIdentifier, connectorId);
                                }
                            } else {
                                meterValues.lastMeterValues = await captureMetervalues(Identifier, requestData, uniqueIdentifier, clientIpAddress, UniqueChargingSessionId, connectorId);
                                console.log(`Last MeterValues for ${uniqueIdentifier} for Connector ${connectorId}: ${meterValues.lastMeterValues}`);
                                if (autostopSettings.isUnitChecked) {
                                    await autostop_unit(meterValues.firstMeterValues, meterValues.lastMeterValues, autostopSettings, uniqueIdentifier, connectorId);
                                } else if (autostopSettings.isPriceChecked) {
                                    await autostop_price(meterValues.firstMeterValues, meterValues.lastMeterValues, autostopSettings, uniqueIdentifier, connectorId);
                                }
                            }
                        } else {
                            console.error('Invalid MeterValues frame:', requestErrors);
                            response = [3, Identifier, { "errors": requestErrors }];
                        }
                    
                        if (sendTo) {
                            sendTo.send(JSON.stringify(response));
                        } else {
                            console.error('No WebSocket connection found for uniqueIdentifier:', uniqueIdentifier);
                        }
                    } else if (requestType === 2 && requestName === "StopTransaction") {
                        const data = requestData[3];
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
                                                                "A", "V", "K", "Celcius", "Celsius", "Fahrenheit", "Percent"
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
                    
                        function validate(data, schema) {
                            const errors = [];
                    
                            schema.required.forEach(field => {
                                if (!data.hasOwnProperty(field)) {
                                    errors.push(`Missing required field: ${field}`);
                                }
                            });
                    
                            Object.keys(schema.properties).forEach(field => {
                                if (data.hasOwnProperty(field)) {
                                    const property = schema.properties[field];
                                    const fieldType = typeof data[field];
                    
                                    if (property.type && field !== 'transactionData') {  // Ignore transactionData type check
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
                                                // Ignore errors related to sampledValue type
                                                const filteredErrors = itemErrors.filter(e => !e.includes('Invalid type for field: sampledValue'));
                                                if (filteredErrors.length > 0) {
                                                    errors.push(`Invalid item at index ${index} in transactionData: ${filteredErrors.join(", ")}`);
                                                }
                                            }
                                        });
                                    }
                                }
                            });
                    
                            return errors;
                        }
                    
                        const connectorId = requestData[3].connectorId; // Get the connector ID from the request
                        const idTag = requestData[3].idTag;
                    
                        const timestamp = requestData[3].timestamp;
                        const sendTo = wsConnections.get(uniqueIdentifier);
                        const requestErrors = validate(data, stopTransactionRequestSchema);
                        const key = `${uniqueIdentifier}_${connectorId}`; // Create a composite key
                    
                        let response;
                        if (requestErrors.length === 0) {
                            const { status, expiryDate } = await checkAuthorization(uniqueIdentifier, idTag);
                            console.log(status);
                            response = [3, Identifier, {
                                "idTagInfo": {
                                    // "expiryDate": expiryDate || new Date().toISOString(),
                                    "parentIdTag": "PARENT12345",
                                    "status": status
                                }
                            }];
                        } else {
                            console.error('Invalid StopTransactionRequest frame:', requestErrors);
                            response = [3, Identifier, {
                                "idTagInfo": {
                                    "status": "Invalid",
                                    "errors": requestErrors
                                }
                            }];
                        }
                        
                        try {
                            const result = await sendTo.send(JSON.stringify(response));
                            
                            if (result === undefined || result) { 
                                // The send operation was successful
                                await UpdateInUse(uniqueIdentifier, idTag, connectorId);
                                console.log("UpdateInUse executed successfully.");
                            } else {
                                throw new Error('Sending message failed.');
                            }
                        } catch (error) {
                            console.error('Error during sending or updating in-use status:', error);
                            throw error; // Re-throw the error if you want to propagate it further
                        }
                        
                        if (charging_states.get(key) === true) {
                            sessionFlags.set(key, 1);
                            StopTimestamp = timestamp;
                            charging_states.set(key, false);
                            startedChargingSet.delete(key);
                        }
                    
                        clearTimeout(autoStopTimer);
                    }

                    if (sessionFlags.get(key) == 1) {
                        let unit;
                        let sessionPrice;
                        const meterValues = getMeterValues(key);
                        if (meterValues.firstMeterValues !== undefined && meterValues.lastMeterValues !== undefined) {
                            ({ unit, sessionPrice } = await calculateDifference(meterValues.firstMeterValues, meterValues.lastMeterValues, uniqueIdentifier));
                            console.log(`Energy consumed during charging session: ${unit} Unit's - Price: ${sessionPrice}`);
                            deleteMeterValues(key);
                        } else {
                            console.log("StartMeterValues or LastMeterValues is not available.");
                        }
                        const user = await getUsername(uniqueIdentifier, connectorId);
                        const startTime = StartTimestamp;
                        const stopTime = StopTimestamp;
                        // Fetch the connector type from socket_gun_config
                        const socketGunConfig = await db.collection('socket_gun_config').findOne({ charger_id: uniqueIdentifier});
                        const connectorIdTypeField = `connector_${connectorId}_type`;
                        const connectorTypeValue = socketGunConfig[connectorIdTypeField];

                        await handleChargingSession(uniqueIdentifier, connectorId, startTime, stopTime, unit, sessionPrice, user, chargingSessionID.get(key), connectorTypeValue);
                
                        if (charging_states.get(key) == false) {
                            const result = await updateCurrentOrActiveUserToNull(uniqueIdentifier, connectorId);
                            chargingSessionID.delete(key);
                            if (result === true) {
                                console.log(`ChargerID ${uniqueIdentifier} ConnectorID ${connectorId} Stop - End charging session is updated successfully.`);
                            } else {
                                console.log(`ChargerID ${uniqueIdentifier} ConnectorID ${connectorId} - End charging session is not updated.`);
                            }
                        } else {
                            console.log('End charging session is not updated - while stop only it will work');
                        }
                
                        StartTimestamp = null;
                        StopTimestamp = null;
                        sessionFlags.set(key, 0);
                    }
                }
            });

            ws.on('close', (code, reason) => {
                if (code === 1001) {
                    console.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed from browser side`);
                    logger.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed from browser side`);
                } else {
                    console.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed with code ${code} and reason: ${reason}`);
                    logger.error(`ChargerID - ${uniqueIdentifier}: WebSocket connection closed with code ${code} and reason: ${reason}`);
                }
                ClientConnections.delete(ws);
                setTimeout(() => {
                    connectWebSocket();
                }, 1000);
            });

            process.on('unhandledRejection', (reason, promise) => {
                console.log('Unhandled Rejection at:', promise, 'reason:', reason);
                logger.info('Unhandled Rejection at:', promise, 'reason:', reason);
            });

            ws.on('error', (error) => {
                try {
                    if (error.code === 'WS_ERR_EXPECTED_MASK') {
                        console.log(`WebSocket error ${uniqueIdentifier}: MASK bit must be set.`);
                        logger.error(`WebSocket error ${uniqueIdentifier}: MASK bit must be set.`);
                        setTimeout(() => {
                            connectWebSocket();
                        }, 1000);
                    } else {
                        console.log(`WebSocket error ${uniqueIdentifier}: ${error.message}`);
                        console.error(error.stack);
                        logger.error(`WebSocket error ${uniqueIdentifier}: ${error.message}`);
                    }
                } catch (err) {
                    console.error(`Error in WebSocket error handler: ${err.message}`);
                    logger.error(`Error in WebSocket error handler: ${err.message}`);
                    console.error(error.stack);
                }
            });
        }

        connectWebSocket();
    });

    const broadcastMessage = async (DeviceID, message, sender)  => {
        const data = { DeviceID, message };
        const jsonMessage = JSON.stringify(data);

        ClientWss.clients.forEach(client => {
            if (client !== sender && client.readyState === WebSocket.OPEN) {
                client.send(jsonMessage, (error) => {
                    if (error) {
                        console.log(`Error sending message to client: ${error.message}`);
                    }
                });
            }
        });
    };
};

module.exports = { handleWebSocketConnection };
