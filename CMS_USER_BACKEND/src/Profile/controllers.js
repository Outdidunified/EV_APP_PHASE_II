const database = require('../../db');
const logger = require('../../logger');
const bcrypt = require('bcrypt');


// PROFILE Functions
//FetchUserProfile
async function FetchUserProfile(req, res) {
    const { user_id } = req.body;

    try {
        const db = await database.connectToDatabase();
        const usersCollection = db.collection("users");
        
        // Query to fetch the user by user_id
        const user = await usersCollection.findOne({ user_id: user_id , status:true });

        if (!user) {
            return res.status(404).json({ message: 'User not found or inactive' });
        }

        return res.status(200).json({ status: 'Success', data: user });
        
    } catch (error) {
        logger.error(`Error fetching user: ${error}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}
// UpdateUserProfile
async function UpdateUserProfile(req, res, next) {
    const { user_id, username, phone_no, password } = req.body;

    try {
        // Validate the input
        if (!user_id || !username || !phone_no || !password) {
            return res.status(400).json({ message: 'User ID, Username, Phone Number, and Password are required' });
        }

        const db = await database.connectToDatabase();
        const usersCollection = db.collection("users");

        // Check if the user exists
        const existingUser = await usersCollection.findOne({ user_id: user_id });
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Convert password to a string if it is not already
        const passwordString = String(password);

        // Hash the password
        const hashedPassword = await bcrypt.hash(passwordString, 10);

        // Update the user profile
        const updateResult = await usersCollection.updateOne(
            { user_id: user_id },
            {
                $set: {
                    username: username,
                    phone_no: phone_no,
                    password: hashedPassword,
                    modified_by: username,
                    modified_date: new Date(),
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(500).json({ message: 'Failed to update user profile' });
        }
        next();        
    } catch (error) {
        console.error(error);
        logger.error(`Error updating user profile: ${error}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}
//DeActivate User
async function DeActivateUser(req, res, next) {
    try {
        const { user_id, username, status } = req.body;

        // Validate the input
        if (!username || !user_id || typeof status !== 'boolean') {
            return res.status(400).json({ message: 'User ID, username, and Status (boolean) are required' });
        }

        const db = await database.connectToDatabase();
        const Users = db.collection("users");

        // Check if the user exists
        const existingUser = await Users.findOne({ user_id: user_id });
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update user status
        const updateResult = await Users.updateOne(
            { user_id: user_id },
            {
                $set: {
                    status: status,
                    modified_by: username,
                    modified_date: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(500).json({ message: 'Failed to update user status' });
        }

        next();
    } catch (error) {
        console.error(error);
        logger.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}


module.exports = {
    //PROFILE ROUTE
    FetchUserProfile,
    UpdateUserProfile,
    DeActivateUser,
};