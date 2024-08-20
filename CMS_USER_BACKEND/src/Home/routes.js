const express = require('express');
const router = express.Router();
const controllers = require("./controllers.js")
const database = require('../../db');
const { wsConnections, uniqueKey, OCPPResponseMap } = require('../../MapModules.js');
const { v4: uuidv4 } = require('uuid');
const url = require('url');
const logger = require('../../logger.js');

//Route to Check charger ID from database
router.post('/SearchCharger', controllers.searchCharger);
router.post('/updateConnectorUser', controllers.updateConnectorUser);

//Route to filter charger based on user preference 
//getRecentSessionDetails
router.post('/getRecentSessionDetails', controllers.getRecentSessionDetails);

router.post('/getAllChargersWithStatusAndPrice', controllers.getAllChargersWithStatusAndPrice);


//Fetch all action options for OCPPConfig
router.get('/GetAction', async(req, res) => {

    try {
        const db = await database.connectToDatabase();
        const collection = db.collection('ocpp_actions');

        const Data = await collection.find({}).toArray();

        // Map the database documents into the desired format
        const ResponseVal = Data.map(item => {
            return {
                action: item.action,
                payload: JSON.parse(item.payload)
            };
        });

        res.status(200).json(ResponseVal);
    } catch (error) {
        console.log("Error form GetAction - ", error);
        logger.error("Error form GetAction - ", error);
    }

})


// Route to send request to charger from OCPPConfig
router.post('/SendOCPPRequest', async (req, res) => {
    const { id, req: payload, actionBtn: action } = req.body;

    const deviceIDToSendTo = id; // Specify the device ID you want to send the message to
    const wsToSendTo = wsConnections.get(id);
    let ReqMsg = "";

    const uniqueId = uuidv4();
    uniqueKey.set(id, uniqueId);
    const Key = uniqueKey.get(id);

    if (wsToSendTo) {
        switch (action) {
            case "GetConfiguration":
                ReqMsg = [2, Key, "GetConfiguration", payload];
                break;
            case "DataTransfer":
                ReqMsg = [2, Key, "DataTransfer", payload];
                break;
            case "UpdateFirmware":
                ReqMsg = [2, Key, "UpdateFirmware", payload];
                break;
            case "ChangeConfiguration":
                ReqMsg = [2, Key, "ChangeConfiguration", payload];
                break;
            case "ClearCache":
                ReqMsg = [2, Key, "ClearCache", ''];
                break;
            case "TriggerMessage":
                ReqMsg = [2, Key, "TriggerMessage", payload];
                break;
            case "Reset":
                ReqMsg = [2, Key, "Reset", payload];
                break;
            case "UnlockConnector":
                ReqMsg = [2, Key, "UnlockConnector", payload];
                break;
            case "RemoteStartTransaction":
                ReqMsg = [2, Key, "RemoteStartTransaction", { "connectorId": 1, "idTag": "B4A63CDB", "timestamp": new Date().toISOString() }];
                break;
            case "RemoteStopTransaction":
                ReqMsg = [2, Key, "RemoteStopTransaction", payload];
                break;
            case "GetDiagnostics":
                ReqMsg = [2, Key, "GetDiagnostics", payload];
                break;
            case "ChangeAvailability":
                ReqMsg = [2, Key, "ChangeAvailability", payload];
                break;
            case "CancelReservation":
                ReqMsg = [2, Key, "CancelReservation", payload];
                break;
            case "ReserveNow":
                ReqMsg = [2, Key, "ReserveNow", payload];
                break;
            case "SendLocalList":
                ReqMsg = [2, Key, "SendLocalList", payload];
                break;
            case "GetLocalListVersion":
                ReqMsg = [2, Key, "GetLocalListVersion", payload];
                break;
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }

        // Map the WebSocket connection to the HTTP response
        OCPPResponseMap.set(wsToSendTo, res);
        wsToSendTo.send(JSON.stringify(ReqMsg));

        console.log('Request message sent to the OCPP Request client for device ID:', deviceIDToSendTo);
        logger.info('Request message sent to the OCPP Request client for device ID:', deviceIDToSendTo);

    } else {
        // Charger ID Not Found/Available
        console.log('OCPP Request client not found for the specified device ID:', deviceIDToSendTo);
        logger.info('OCPP Request client not found for the specified device ID:', deviceIDToSendTo);
        res.status(404).json({ message: `OCPP Request client not found for the specified device ID: ${deviceIDToSendTo}` });
    }
});



// Export the router
module.exports = router;