const database = require('../../db');
const logger = require('../../logger');
const { wsConnections } = require('../../MapModules.js');

//fetchLastStatus
async function fetchLastStatus(req, res) {
    const { id } = req.body;

    try {
        const db = await database.connectToDatabase();
        const latestStatus = await db.collection('charger_status').findOne({ charger_id: id });
        const fetchCapacity = await db.collection('charger_details').findOne({ charger_id: id });
        
        if (!fetchCapacity) {
            const errorMessage = `ChargerID - ${id} not found in charger_details`;
            console.log(errorMessage);
            return res.status(404).json({ message: errorMessage });
        }

        const convertedCapacity = fetchCapacity.max_power / 1000;

        if (latestStatus) {
            console.log(`ChargerID - ${id} last status fetched from the database`);
            res.status(200).json({ 
                data: latestStatus, 
                UnitPrice: fetchCapacity.unit_price, 
                ChargerCapacity: convertedCapacity 
            });
        } else {
            const errorMessage = `ChargerID - ${id} No last data found`;
            console.log(errorMessage);
            res.status(404).json({ message: errorMessage });
        }
    } catch (error) {
        console.error(`ChargerID: ${id} - Error occurred while FetchLaststatus:`, error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

// Fetch ip and update user
async function getIpAndupdateUser(chargerID, user) {
    try {
        const db = await database.connectToDatabase();
        const getip = await db.collection('charger_details').findOne({ charger_id: chargerID });
        const ip = getip.ip;
        console.log(chargerID,user)
        if (getip) {
            if (user !== undefined) {
                const updateResult = await db.collection('charger_details').updateOne({ charger_id: chargerID }, { $set: { current_or_active_user: user } });

                if (updateResult.modifiedCount === 1) {
                    console.log(`Updated current_or_active_user to ${user} successfully for ChargerID ${chargerID}`);
                } else {
                    console.log(`Failed to update current_or_active_user for ChargerID ${chargerID}`);
                }
            } else {
                console.log('User is undefined - On stop there will be no user details');
            }

            return ip;
        } else {
            console.log(`GetIP Unsuccessful`);
        }
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Internal Server Error' });
    }

}

async function chargerStopCall(id) {
    try {
        const db = await database.connectToDatabase();
        const transData = await db.collection('charger_details').findOne({ charger_id: id });

        if (transData) {
            const wsToSendTo = wsConnections.get(id);
            const Tag_ID = TagID.get(id);
            if (wsToSendTo) {
                const transId = transData.transaction_id;
                const remoteStopRequest = [2, Tag_ID.toISOString(), "RemoteStopTransaction", { "transactionId": transId }];
                wsToSendTo.send(JSON.stringify(remoteStopRequest));

                console.log('Stop message sent to the WebSocket client for device ID:', id);
                logger.info('Stop message sent to the WebSocket client for device ID:', id);
                return true;
            } else {
                console.log('WebSocket client not found in stop charger device ID:', id);
                logger.info('WebSocket client not found in stop charger device ID:', id);
                return false;
            }
        } else {
            console.log(`ID: ${id} - TransactionID/ChargerID not set or not available !`);
            logger.error(`ID: ${id} - TransactionID/ChargerID not set or not available !`);
            return false; // or you can return an object here as you did before
        }
    } catch (error) {
        console.log(`ChargerID: ${id} - Transaction ID not set or not available: ${error}`);
        logger.error(`ChargerID: ${id} - Transaction ID not set or not available: ${error}`);
        return false; // or you can return an object here as you did before
    }
}

// END CHARGING SESSION
async function endChargingSession(req, res) {
    try {
        const { charger_id } = req.body; // Extract charger_id properly
        if (!charger_id) {
            return res.status(400).json({ message: 'Charger ID is required' });
        }

        const db = await database.connectToDatabase();
        const chargerDetailsCollection = db.collection('charger_details');
        const chargerStatusCollection = db.collection('charger_status');

        // Find the charger status
        const chargerStatus = await chargerStatusCollection.findOne({ charger_id });

        if (!chargerStatus) {
            const errorMessage = 'Charger status not found!';
            return res.status(404).json({ message: errorMessage });
        }

        // Check if the status is one of the acceptable statuses
        if (['Available', 'Faulted', 'Finishing', 'Unavailable'].includes(chargerStatus.charger_status)) {
            const result = await chargerDetailsCollection.updateOne(
                { charger_id }, // Match by charger_id
                { $set: { current_or_active_user: null } }
            );

            if (result.modifiedCount === 0) {
                const errorMessage = 'Failed to update the charging session';
                return res.status(404).json({ message: errorMessage });
            }

            return res.status(200).json({ status: "Success", message: 'End Charging session updated successfully.' });
        } else {
            console.log("endChargingSession - Status is not in Available/Faulted/Finishing/Unavailable");
            return res.status(200).json({ message: 'OK' });
        }
    } catch (error) {
        console.error('Error updating end charging session:', error);
        const errorMessage = 'Internal Server Error';
        return res.status(500).json({ message: errorMessage });
    }
}

module.exports = {
    //LAST STATUS
    fetchLastStatus,
    getIpAndupdateUser,
    chargerStopCall,
    //END CHARGING SESSION
    endChargingSession,
};