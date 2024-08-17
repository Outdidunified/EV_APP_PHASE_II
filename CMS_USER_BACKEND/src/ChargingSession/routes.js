const express = require('express');
const router = express.Router();
const controllers = require("./controllers.js");
const database = require('../../db');
const { wsConnections, uniqueKey, TagID } = require('../../MapModules.js');
const { v4: uuidv4 } = require('uuid');

router.post('/FetchLaststatus', controllers.fetchLastStatus);

// Route to start the charger
router.post('/start', async (req, res) => {
    const { id, user_id, connector_id, connector_type } = req.body;
    console.log(req.body)
    const wsToSendTo = wsConnections.get(id);

    if (!id || !user_id || !connector_id || !connector_type) {
        return res.status(400).json({ message: 'Charger ID, user_id, Connector ID, and Connector Type are required.' });
    }

    const uniqueId = uuidv4();
    uniqueKey.set(id, uniqueId);
    const Key = uniqueKey.get(id);

    const db = await database.connectToDatabase();
    const chargerDetailsCollection = db.collection('charger_details');
    const userDetailsCollection = db.collection('users');
    //const tagIdCollection = db.collection('tag_id');

    // Fetch the user details to get the associated tag_id
    // const userDetails = await userDetailsCollection.findOne({ user_id });

    // if (!userDetails || !userDetails.tag_id) {
    //     return res.status(404).json({ message: 'User ID or associated Tag ID not found in the database.' });
    // }

    // const userTagId = userDetails.tag_id;

    // Fetch the tag_id details from the tag_id table
    //const tagIdDetails = await tagIdCollection.findOne({ id: userTagId });

    const tagIdDetails = { tag_id: await generateTagID() };

    console.log(tagIdDetails);

    if (!tagIdDetails || !tagIdDetails.tag_id) {
        return res.status(404).json({ message: 'Tag ID not found in the tag_id table.' });
    }

    const tagId = tagIdDetails.tag_id || "BS5756" ;
    console.log(tagId)
    // Generate the field name for the tag_id based on connector_id
    const connectorTagIdField = `tag_id_for_connector_${connector_id}`;
    const connectorTagIdInUseField = `tag_id_for_connector_${connector_id}_in_use`;

    // Store the tag ID for further processing
    TagID.set(id, tagId);
    const Tag_ID = TagID.get(id);

    if (wsToSendTo) {
        const remoteStartRequest = [2, Key, "RemoteStartTransaction", {
            "connectorId": connector_id,
            "idTag": Tag_ID || "BS5756", // Use the specific tag_id for this connector
        }];

        console.log("remoteStartRequest", remoteStartRequest);
        wsToSendTo.send(JSON.stringify(remoteStartRequest));

        // Update the charger_details with the tag_id for the specific connector
        const updateResult = await chargerDetailsCollection.updateOne(
            { charger_id: id },
            { 
                $set: { 
                    [connectorTagIdField]: tagId,
                    [connectorTagIdInUseField]: false 
                } 
            }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: 'Charger ID not found in the charger_details table.' });
        } else if (updateResult.modifiedCount === 0) {
            return res.status(500).json({ message: 'Failed to update the charger details with the tag ID.' });
        }

        console.log('StartCharger message sent to the WebSocket client for device ID:', id);
        res.status(200).json({ message: `StartCharger message sent to the WebSocket client for device ID: ${id}, Connector ID: ${connector_id}, Connector Type: ${connector_type}` });
    } else {
        console.log('WebSocket client not found for charger ID:', id);
        res.status(404).json({ message: `Charger ID not available in the WebSocket client for device ID: ${id}` });
    }
});

async function generateTagID() {
    const prefix = 'T'; // Single character prefix to ensure the total length is 7
    const randomNum = Math.floor(Math.random() * 1000000); // Generates a random number up to 6 digits
    const tagId = `${prefix}${randomNum.toString().padStart(6, '0')}`; // Combine and pad to ensure 7 characters

    return tagId;
}

// Route to stop the charger
router.post('/stop', async (req, res) => {
    const id = req.body.id;
    const connectorId = req.body.connectorId
    console.log(req.body)
    const result = await controllers.chargerStopCall(id, connectorId);

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
        const connectorId = req.body.connectorId;
        const user = req.body.user;
        const db = await database.connectToDatabase();
        const chargingSessionResult = await db.collection('device_session_details')
            .find({ charger_id: chargerID, user: user , connector_id: connectorId})
            .sort({ stop_time: -1 })
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
        res.status(200).json({ message: 'Success', value: combinedResult });
    } catch (error) {
        console.error('getUpdatedCharingDetails- Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Route to end charging session
router.post('/endChargingSession', controllers.endChargingSession);



// Route to Update user details
router.post('/UpdateAutoStopSettings', async function(req, res) {
    try {
        const user_id = req.body.user_id;
        const autostop_time = parseInt(req.body.updateUserTimeVal);
        const autostop_unit = parseInt(req.body.updateUserUnitVal);
        const autostop_price = parseInt(req.body.updateUserPriceVal);
        const autostop_time_isChecked = req.body.updateUserTime_isChecked;
        const autostop_unit_isChecked = req.body.updateUserUnit_isChecked;
        const autostop_price_isChecked = req.body.updateUserPrice_isChecked;

        if (!user_id || isNaN(autostop_time) || isNaN(autostop_unit) || isNaN(autostop_price)) {
            const errorMessage = 'Update User - Values undefined or invalid';
            return res.status(401).json({ message: errorMessage });
        }

        const db = await database.connectToDatabase();
        const usersCollection = db.collection('users');
        // Update the user details
        const result = await usersCollection.updateOne(
            { user_id: user_id }, 
            { 
                $set: { 
                    autostop_time: autostop_time, 
                    autostop_unit: autostop_unit, 
                    autostop_price: autostop_price, 
                    autostop_time_is_checked: autostop_time_isChecked, 
                    autostop_unit_is_checked: autostop_unit_isChecked, 
                    autostop_price_is_checked: autostop_price_isChecked
                }
            }
        );
        
        if (result.modifiedCount === 1) {
            console.log(`User ${user_id} details updated successfully`);
            res.status(200).json({ message: `User ${user_id} details updated successfully` });
        } else {
            console.log(`User ${user_id} not found`);
            res.status(404).json({ message: `User ${user_id} not found` });
        }
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});


// Export the router
module.exports = router;
