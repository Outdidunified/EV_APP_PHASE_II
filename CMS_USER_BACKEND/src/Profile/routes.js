const express = require('express');
const router = express.Router();
const Auth = require("./auth.js")
const controllers = require("./controllers.js")

//AUTHENTICATION ROUTES
// Route to check login credentials
router.post('/CheckLoginCredentials', async (req, res) => {
    try {
        const result = await Auth.authenticate(req);

        if (result.error) {
            return res.status(result.status).json({ message: result.message });
        }

        res.status(200).json({ status: 'Success', data: result.user });
    } catch (error) {
        console.error('Error in CheckLoginCredentials route:', error);
        res.status(500).json({ status: 'Failed', message: 'Failed to authenticate user' });
    }
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
router.post('/RegisterNewUser', Auth.registerUser, (req, res) => {
    try {
        res.status(200).json({ status: 'Success' , message : "User Registered Successfully"});
    } catch (error) {
        console.error('Error in RegisterNewUser route:', error);
        res.status(500).json({ status: 'Failed', message: 'Failed to RegisterNewUser' });
    }
});

// PROFILE Route
// Route to FetchUserProfile 
router.post('/FetchUserProfile',controllers.FetchUserProfile, async (req, res ) => {
});
// Route to UpdateUserProfile 
router.post('/UpdateUserProfile',controllers.UpdateUserProfile, async (req, res) => {
    try {
        res.status(200).json({ status: 'Success',message: 'User profile updated successfully' });
    } catch (error) {x
        console.error('Error in UpdateUserProfile route:', error);
        res.status(500).json({ status: 'Failed', message: 'Failed to update user profile' });
    }
});
// Route to DeleteAccount
router.post('DeleteAccount', controllers.DeActivateUser, (req, res) => {
    res.status(200).json({ status: 'Success' ,  message: 'User deactivated successfully' });
});


// Export the router
module.exports = router;