const express = require('express');
const auth = require('./auth');
const database = require('./db');
const url = require('url');
const logger = require('./logger');
var sha256 = require('sha256');
var uniqid = require('uniqid');
var axios = require('axios');
const cors = require('cors');

// Create a router instance
const router = express.Router();

// Enable CORS
router.use(cors());

// Parse URL-encoded bodies
router.use(express.urlencoded({ extended: true }));

// Route to check login credentials
router.post('/CheckLoginCredentials', auth.authenticate, (req, res) => {
    res.status(200).json({ message: 'Success' });
});

// Route to logout and update users fields
router.post('/LogoutCheck', async(req, res) => {
    const chargerID = req.body.ChargerID;
    try {
        const db = await database.connectToDatabase();
        const latestStatus = await db.collection('ev_charger_status').findOne({ chargerID: chargerID });

        if (latestStatus) {
            if (latestStatus.status === 'Available' || latestStatus.status === 'Faulted') {
                const collection = db.collection('ev_details');
                const result = await collection.updateOne({ ChargerID: chargerID }, { $set: { current_or_active_user: null } });

                if (result.modifiedCount === 0) {
                    console.log('logoutCheck - Not Updated !');
                    res.status(200).json({ message: 'NOT OK' });
                } else {
                    console.log('logoutCheck - Updated !');
                    res.status(200).json({ message: 'OK' });
                }
            } else {
                console.log("logoutCheck - Status is not in Available");
                res.status(200).json({ message: 'OK' });
            }
        }

    } catch (error) {
        console.error('LoginCheck - error while update:', error);
        res.status(200).json({ message: 'LoginCheck - error while update' });
    }
});

// Route to add a new user (Save into database)
router.post('/RegisterNewUser', auth.registerUser, (req, res) => {
    res.status(200).json({ message: 'Success' });
});





// Export the router
module.exports = router;