const database = require('../../db');
const logger = require('../../logger');

//SEARCH CHARGER
async function searchCharger(req, res) {
    try {
        const { searchChargerID: ChargerID, Username: user , user_id} = req.body;
        
        const db = await database.connectToDatabase();
        const evDetailsCollection = db.collection('charger_details');
        const usersCollection = db.collection('users');

        // Search for the document in the 'charger_details' collection
        const chargerDetails = await evDetailsCollection.findOne({ charger_id: ChargerID , status: true });

        if (!chargerDetails) {
            const errorMessage = 'Device ID not found !';
            return res.status(404).json({ message: errorMessage });
        }

        // Check if current_or_active_user is already set
        if (chargerDetails.current_or_active_user && user !== chargerDetails.current_or_active_user) {
            const errorMessage = 'Charger is already in use !';
            return res.status(400).json({ message: errorMessage });
        }

        // Get wallet balance from the 'users' collection
        const userRecord = await usersCollection.findOne({ user_id: user_id });

        if (!userRecord) {
            const errorMessage = 'User not found';
            return res.status(404).json({ message: errorMessage });
        }

        const walletBalance = userRecord.wallet_bal;
        ///////
        if (chargerDetails.charger_accessibility === 1) {
            if (chargerDetails.AssignedUser !== user) {            
                const errorMessage = 'Access Denied: You do not have permission to use this private charger.';
                return res.status(400).json({ message: errorMessage });
            }
        } else {
            // Check if wallet balance is below 100 Rs
            if (walletBalance < 100) {
                const errorMessage = 'Your wallet balance is not enough to charge (minimum 100 Rs required)';
                return res.status(400).json({ message: errorMessage });
            }
        }
        // Update the user field in the chargerDetails
        chargerDetails.user = user;
        // Update the document in the 'ev_details' collection
        const updateResult = await evDetailsCollection.updateOne({ charger_id: ChargerID }, { $set: { current_or_active_user: user } });

        if (updateResult.modifiedCount !== 1) {
            console.log('Failed to update current_or_active username');
        }

        // Respond with the charger details
        res.status(200).json({ status: 'Success'});

    } catch (error) {
        console.error('Error searching for charger:', error);
        const errorMessage = 'Internal Server Error';
        return res.status(500).json({ message: errorMessage });
    }
}



//FILTER CHARGERS
//getAvailableChargers
async function getAvailableChargers(req, res) {
    try {
        const db = await database.connectToDatabase();
        const chargerStatusCollection = db.collection('charger_status');

        // Fetch all chargers where the status is "Available"
        const availableChargers = await chargerStatusCollection.find({ charger_status: "Available" }).toArray();

        if (availableChargers.length === 0) {
            return res.status(404).json({ message: 'No chargers with status "Available" found.' });
        }

        return res.status(200).json({ status: "Success", availableChargers });

    } catch (error) {
        console.error('Error fetching available chargers:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

//getRecentSessionDetails
async function getRecentSessionDetails(req, res) {
    try {
        const { username } = req.body;
        if (!username) {
            const errorMessage = 'ChargerSessionDetails - Username undefined!';
            return res.status(401).json({ message: errorMessage });
        }
        const db = await database.connectToDatabase();
        const collection = db.collection('device_session_details');

        // Fetch all charging sessions for the user
        const sessions = await collection.find({ user: username, stop_time: { $ne: null } }).sort({ stop_time: -1 }).toArray();

        if (!sessions || sessions.length === 0) {
            const errorMessage = 'ChargerSessionDetails - No record found!';
            return res.status(404).json({ message: errorMessage });
        }

        // Filter to get the most recent session per charger_id
        const recentSessionsByCharger = sessions.reduce((acc, session) => {
            if (!acc[session.charger_id] || new Date(acc[session.charger_id].stop_time) < new Date(session.stop_time)) {
                acc[session.charger_id] = session;
            }
            return acc;
        }, {});

        // Convert the result object to an array
        const recentSessions = Object.values(recentSessionsByCharger);

        // Return the most recent session data for each charger
        return res.status(200).json({ data: recentSessions });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ message: 'Internal Server Error' });
    }
}



module.exports = { 
    //SEARCH CHARGER
    searchCharger,
    //FILTER CHARGERS
    getAvailableChargers,
    getRecentSessionDetails,
};
