const database = require('../../db');
const logger = require('../../logger');
const { wsConnections } = require('../../MapModules.js');

// Search Charger and Get Configuration
async function searchCharger(req, res) {
    try {
        const { searchChargerID: ChargerID } = req.body;
        const db = await database.connectToDatabase();
        const evDetailsCollection = db.collection('charger_details');
        const socketGunConfigCollection = db.collection('socket_gun_config');

        const chargerDetails = await evDetailsCollection.findOne({ charger_id: ChargerID, status: true });

        if (!chargerDetails) {
            const errorMessage = 'Device ID not found !';
            return res.status(404).json({ message: errorMessage });
        }

        const socketGunConfig = await socketGunConfigCollection.findOne({ charger_id: ChargerID });

        res.status(200).json({ status: 'Success', socketGunConfig });

    } catch (error) {
        console.error('Error searching for charger:', error);
        const errorMessage = 'Internal Server Error';
        return res.status(500).json({ message: errorMessage });
    }
}

// Update Connector User
async function updateConnectorUser(req, res) {
    try {
        const { searchChargerID: ChargerID, Username: user, user_id, connector_id } = req.body;
        const db = await database.connectToDatabase();
        const evDetailsCollection = db.collection('charger_details');
        const usersCollection = db.collection('users');
        const socketGunConfigCollection = db.collection('socket_gun_config');
        const chargerStatusCollection = db.collection('charger_status');

        const chargerDetails = await evDetailsCollection.findOne({ charger_id: ChargerID, status: true });
        const socketGunConfig = await socketGunConfigCollection.findOne({ charger_id: ChargerID });

        if (!chargerDetails) {
            const errorMessage = 'Device ID not found!';
            return res.status(404).json({ message: errorMessage });
        }

        const connectorField = `current_or_active_user_for_connector_${connector_id}`;
        if (!chargerDetails.hasOwnProperty(connectorField)) {
            const errorMessage = 'Invalid connector ID!';
            return res.status(400).json({ message: errorMessage });
        }

        if (chargerDetails[connectorField] && user !== chargerDetails[connectorField]) {
            const errorMessage = 'Connector is already in use!';
            return res.status(400).json({ message: errorMessage });
        }

        const userRecord = await usersCollection.findOne({ user_id: user_id });

        if (!userRecord) {
            const errorMessage = 'User not found';
            return res.status(404).json({ message: errorMessage });
        }

        const walletBalance = userRecord.wallet_bal;

        if (chargerDetails.charger_accessibility === 1) {
            if (chargerDetails.AssignedUser !== user) {
                const errorMessage = 'Access Denied: You do not have permission to use this private charger.';
                return res.status(400).json({ message: errorMessage });
            }
        } else {
            if (walletBalance < 100) {
                const errorMessage = 'Your wallet balance is not enough to charge (minimum 100 Rs required)';
                return res.status(400).json({ message: errorMessage });
            }
        }

        // Update the user field in the chargerDetails
        let currect_user = {};
        currect_user[connectorField] = user;

        const connectorIdTypeField = `connector_${connector_id}_type`;
        const connectorTypeValue = socketGunConfig[connectorIdTypeField];
        if (connectorTypeValue === 1) { // Assuming 1 stands for 'socket'
            const fetchChargerStatus = await chargerStatusCollection.findOne({ charger_id: ChargerID, connector_id: connector_id , connector_type: 1});

            if (fetchChargerStatus && fetchChargerStatus.charger_status !== 'Charging' && fetchChargerStatus.charger_status !== 'Preparing') {

                const result = await sendPreparingStatus(wsConnections, ChargerID, connector_id);

                if (!result) {
                    const errorMessage = 'Device not connected to the server';
                    return res.status(500).json({ message: errorMessage });
                }
            }
        }

        const updateResult = await evDetailsCollection.updateOne(
            { charger_id: ChargerID },
            { $set: currect_user }
        );

        if (updateResult.modifiedCount !== 1) {
            console.log('Failed to update current_or_active username for the connector');
        }

        // Respond with the charger details
        res.status(200).json({ message: 'Success' });

    } catch (error) {
        console.error('Error updating connector user:', error);
        const errorMessage = 'Internal Server Error';
        return res.status(500).json({ message: errorMessage });
    }
}

const sendPreparingStatus = async (wsConnections, Identifier, connectorId) => {
    const id = Identifier;
    const sendTo = wsConnections.get(Identifier);
    const db = await database.connectToDatabase();
    const evDetailsCollection = db.collection('charger_details');
    const chargerDetails = await evDetailsCollection.findOne({ charger_id: id });

    if (!chargerDetails) {
        const errorMessage = 'Charger ID not found in the database.';
        console.error(errorMessage);
        return false;
    }

    const vendorId = chargerDetails.vendor; // Fetch vendorId from charger_details collection

    let response;
    if (connectorId == 1) {
        response = [2, Identifier, "DataTransfer", {
            "vendorId": vendorId, // Use fetched vendorId
            "messageId": "TEST",
            "data": "Preparing",
            "connectorId": connectorId,
        }];
    }

    if (sendTo) {
        await sendTo.send(JSON.stringify(response));
        let WS_MSG = `ChargerID: ${id} - SendingMessage: ${JSON.stringify(response)}`;
        logger.info(WS_MSG);
        console.log(WS_MSG);
        return true;
    } else {
        return false;
    }
};

// FILTER CHARGERS
// getRecentSessionDetails
async function getRecentSessionDetails(req, res) {
    try {
        const { user_id } = req.body;
        if (!user_id) {
            const errorMessage = 'User ID is undefined!';
            return res.status(401).json({ message: errorMessage });
        }

        const db = await database.connectToDatabase();
        const collection = db.collection('device_session_details');
        const chargerDetailsCollection = db.collection('charger_details');
        const chargerStatusCollection = db.collection('charger_status');
        const usersCollection = db.collection('users');
        const financeDetailsCollection = db.collection('finance_details');

        // Fetch the user details to get the username
        const userRecord = await usersCollection.findOne({ user_id: user_id });
        if (!userRecord) {
            const errorMessage = 'User not found';
            return res.status(404).json({ message: errorMessage });
        }

        const username = userRecord.username;

        // Fetch all charging sessions for the user
        const sessions = await collection.find({ user: username, stop_time: { $ne: null } }).sort({ stop_time: -1 }).toArray();

        if (!sessions || sessions.length === 0) {
            const errorMessage = 'No Charger entries';
            return res.status(404).json({ message: errorMessage });
        }

        // Filter to get the most recent session per charger_id, connector_id, and connector_type
        const recentSessionsByConnector = sessions.reduce((acc, session) => {
            const key = `${session.charger_id}-${session.connector_id}-${session.connector_type}`;
            if (!acc[key] || new Date(acc[key].stop_time) < new Date(session.stop_time)) {
                acc[key] = session;
            }
            return acc;
        }, {});

        // Convert the result object to an array
        const recentSessions = Object.values(recentSessionsByConnector);

        // Join the recent sessions with charger details, charger status, and unit price
        const detailedSessions = await Promise.all(recentSessions.map(async (session) => {
            const details = await chargerDetailsCollection.findOne({ charger_id: session.charger_id });
            const status = await chargerStatusCollection.findOne({ charger_id: session.charger_id, connector_id: session.connector_id });

            // Find the finance ID related to the charger
            const financeId = details?.finance_id;
            // Fetch t  he unit price using the finance ID
            let unitPrice = null;
            if (financeId) {
                const financeRecord = await financeDetailsCollection.findOne({ finance_id: financeId });
                unitPrice = financeRecord ? financeRecord.eb_charges : null;
            }

            return {
                ...session,
                details,
                status,
                unit_price: unitPrice // Append the unit price to the session details
            };
        }));
        // Return the most recent session data for each charger and connector
        return res.status(200).json({ data: detailedSessions });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ message: 'Internal Server Error' });
    }
}



module.exports = { 
    //SEARCH CHARGER
    searchCharger,
    updateConnectorUser,
    //FILTER CHARGERS
    getRecentSessionDetails,
};
