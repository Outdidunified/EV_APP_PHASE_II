const express = require('express');
const router = express.Router();
const controllers = require("./controllers.js");
const database = require('../../db');
const { wsConnections, uniqueKey, TagID } = require('../../MapModules.js');
const { v4: uuidv4 } = require('uuid');

router.post('/FetchLaststatus', controllers.fetchLastStatus);

// Route to start the charger
router.post('/start', async (req, res) => {
    const id = req.body.id;
    // const user = req.body.user;
    // const ip = await controllers.getIpAndupdateUser(id, user);
    const wsToSendTo = wsConnections.get(id);

    const uniqueId = uuidv4();
    uniqueKey.set(id, uniqueId);
    const Key = uniqueKey.get(id);

    const db = await database.connectToDatabase();
    const chargerDetailsCollection = db.collection('charger_details');
    const chargerDetails = await chargerDetailsCollection.findOne({ charger_id: id });
    if (!chargerDetails) {
        return res.status(404).json({ message: 'Charger ID not found in the database.' });
    }
    const tagId = chargerDetails.tag_id;
    TagID.set(id, tagId);
    const Tag_ID = TagID.get(id);

    if (wsToSendTo) {
        const remoteStartRequest = [2, Key, "RemoteStartTransaction", {
            "connectorId": 1,
            "idTag": Tag_ID || "B4A63CDB", // from db
            "timestamp": new Date().toISOString(),
            "meterStart": 0,
            "reservationId": 0
        }];
        console.log("remoteStartRequest", remoteStartRequest);
        wsToSendTo.send(JSON.stringify(remoteStartRequest));

        console.log('StartCharger message sent to the WebSocket client for device ID:', id);
        res.status(200).json({ message: `StartCharger message sent to the WebSocket client for device ID: ${id}` });
    } else {
        // Charger ID Not Found/Available
        console.log('WebSocket client not found in start charger device ID:', id);
        res.status(404).json({ message: `ChargerID not available in the WebSocket client for device ID: ${id}` });
    }
});

// Route to stop the charger
router.post('/stop', async (req, res) => {
    const id = req.body.id;
    const result = await controllers.chargerStopCall(id);

    if (result === true) {
        res.status(200).json({ message: `Stop message sent to the WebSocket client for device ID: ${id}` });
    } else {
        res.status(404).json({ message: `ChargerID not available in the WebSocket client deviceID: ${id}` });
    }
});

// Route to get charging session details at the time of stop
router.post('/getUpdatedCharingDetails', async (req, res) => {
    try {
        const chargerID = req.body.chargerID;
        const user = req.body.user;
        const db = await database.connectToDatabase();
        const chargingSessionResult = await db.collection('device_session_details')
            .find({ charger_id: chargerID, user: user })
            .sort({ StopTimestamp: -1 })
            .limit(1)
            .next();

        if (!chargingSessionResult) {
            return res.status(404).json({ error: 'getUpdatedCharingDetails - Charging session not found' });
        }
        const userResult = await db.collection('users').findOne({ username: user });
        if (!userResult) {
            return res.status(404).json({ error: 'getUpdatedCharingDetails - User not found' });
        }
        const combinedResult = {
            chargingSession: chargingSessionResult,
            user: userResult
        };
        console.log(combinedResult);
        res.status(200).json({ message: 'Success', value: combinedResult });
    } catch (error) {
        console.error('getUpdatedCharingDetails- Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Route to end charging session
router.post('/endChargingSession', controllers.endChargingSession);



// Export the router
module.exports = router;
