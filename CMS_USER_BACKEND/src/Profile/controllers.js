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
        const UserData ={
            user_id: user.user_id,
            username: user.username,
            email_id: user.email_id,
            phone_no: user.phone_no,
            password: user.password,
            autostop_price: user.autostop_price,
            autostop_time: user.autostop_time,
            autostop_unit: user.autostop_unit,
            autostop_price_isChecked: user.autostop_price_is_checked,
            autostop_time_isChecked: user.autostop_time_is_checked,
            autostop_unit_isChecked: user.autostop_unit_is_checked
        }
        if (!user) {
            return res.status(404).json({ message: 'User not found or inactive' });
        }
        return res.status(200).json({ status: 'Success', data: UserData });
        
    } catch (error) {
        logger.error(`Error fetching user: ${error}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}
// UpdateUserProfile
async function UpdateUserProfile(req, res, next) {
    const { user_id, username, phone_no, current_password, new_password } = req.body;
    
    try {
        // Validate the input
        if (!user_id || !username || !phone_no || !current_password) {
            return res.status(400).json({ message: 'User ID, Username, Phone Number, and Current Password are required' });
        }

        const db = await database.connectToDatabase();
        const usersCollection = db.collection("users");

        // Check if the user exists
        const existingUser = await usersCollection.findOne({ user_id: user_id });
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Validate the current password
        const isCurrentPasswordValid = await bcrypt.compare(current_password, existingUser.password);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }

        let updateFields = {
            username: username,
            phone_no: phone_no,
            modified_by: username,
            modified_date: new Date(),
        };

        // Only update the password if a new password is provided
        if (new_password) {
            // Convert new password to a string if it is not already
            const newPasswordString = String(new_password);

            // Hash the new password
            const hashedNewPassword = await bcrypt.hash(newPasswordString, 10);

            // Include the hashed new password in the update fields
            updateFields.password = hashedNewPassword;

            // Check if the new data is the same as the existing data
            const isSameData = (
                existingUser.username === username &&
                existingUser.phone_no === phone_no &&
                await bcrypt.compare(newPasswordString, existingUser.password)
            );

            if (isSameData) {
                return res.status(400).json({ message: 'No changes found' });
            }
        } else {
            // Check if the username and phone number are unchanged
            if (existingUser.username === username && existingUser.phone_no === phone_no) {
                return res.status(400).json({ message: 'No changes found' });
            }
        }

        // Update the user profile
        const updateResult = await usersCollection.updateOne(
            { user_id: user_id },
            { $set: updateFields }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(500).json({ message: 'Failed to update user profile' });
        }

        return res.status(200).json({ message: 'User profile updated successfully' });

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