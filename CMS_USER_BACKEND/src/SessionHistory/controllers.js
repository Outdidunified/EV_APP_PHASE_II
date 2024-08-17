const database = require('../../db');
const logger = require('../../logger');

//SESSION HISTORY
async function getChargingSessionDetails(req, res) {
    try {
        const { username } = req.body;
        if (!username) {
            const errorMessage = 'ChargingSessionDetails - Username undefined!';
            return res.status(401).json({ message: errorMessage });
        }

        const db = await database.connectToDatabase();
        const Collection = db.collection('device_session_details');

        // Fetch sessions in descending order by StopTimestamp
        const result = await Collection.find({ user: username, stop_time: { $ne: null } })
            .sort({ stop_time: -1 })  // Ensure the field used in sort is correct
            .toArray();

        if (!result || result.length === 0) {
            const errorMessage = 'ChargingSessionDetails - No record found!';
            return res.status(404).json({ message: errorMessage });
        }

        return res.status(200).json({ value: result });
    } catch (error) {
        console.error('Error fetching charging session details:', error);
        return res.status(500).send({ message: 'Internal Server Error' });
    }
}

//TOTAL SESSION DATA
async function TotalSessionData(req, res) {
    try {
        const { username } = req.body;
        if (!username) {
            const errorMessage = 'ChargingSessionDetails - Username undefined!';
            return res.status(401).json({ message: errorMessage }); 
        }

        const db = await database.connectToDatabase();
        const Collection = db.collection('device_session_details');

        const result = await Collection.find({ user: username, stop_time: { $ne: null } })
            .sort({ StopTimestamp: -1 })
            .toArray();

        if (!result || result.length === 0) {
            const errorMessage = 'ChargingSessionDetails - No record found!';
            return res.status(404).json({ message: errorMessage });
        }

        // Calculate the total charging time and count the sessions
        let totalChargingTime = 0;
        result.forEach(session => {
            const startTime = new Date(session.start_time);
            const stopTime = new Date(session.stop_time);
            const sessionDuration = (stopTime - startTime) / 1000; // duration in seconds
            totalChargingTime += sessionDuration;
        });

        const totalChargingTimeInHours = (totalChargingTime / 3600).toFixed(2); // convert to hours and round to 2 decimal places
        const totalSessions = result.length; // count the total number of sessions

        return res.status(200).json({ status: "Success", totalChargingTimeInHours, totalSessions });
    } catch (error) {
        console.error('Error fetching charging session details:', error);
        return res.status(500).send({ message: 'Internal Server Error' });
    }
}



module.exports = {
    //SESSION HISTORY
    getChargingSessionDetails,
    //TOTAL SESSION DATA
    TotalSessionData,
};