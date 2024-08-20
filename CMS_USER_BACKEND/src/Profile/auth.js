const bcrypt = require('bcrypt');
const database = require('../../db');

const authenticate = async (req) => {
    try {
        const { email_id, password } = req.body;
        // Check if email or password is missing
        if (!email_id || !password) {
            return { error: true, status: 401, message: 'required data not found' };
        }

        const db = await database.connectToDatabase();
        const usersCollection = db.collection('users');

        // Query to get user by email with the role
        const userWithRole = await usersCollection.aggregate([
            { $match: { email_id: email_id, status: true } }, // Check user status
            {
                $lookup: {
                    from: 'user_roles',
                    localField: 'role_id',
                    foreignField: 'role_id',
                    as: 'roles'
                }
            },
            { $unwind: '$roles' },
            { $match: { 'roles.status': true } }, // Check role status
            { $limit: 1 }
        ]).toArray();

        if (userWithRole.length === 0) {
            return { error: true, status: 401, message: 'Invalid credentials or inactive user/role' };
        }

        const user = userWithRole[0];

        // Ensure both passwords are treated as strings
        const passwordString = password.toString();
        const userPasswordString = user.password.toString();

        // Verify the password
        const passwordMatch = await bcrypt.compare(passwordString, userPasswordString);
        if (!passwordMatch) {
            return { error: true, status: 401, message: 'Invalid credentials' };
        }

        // Return user_id and email_id
        return { error: false, user: { user_id: user.user_id, username: user.username, email_id: user.email_id } };

    } catch (error) {
        console.error(error);
        return { error: true, status: 500, message: 'Internal Server Error' };
    }
};

const registerUser = async (req, res, next) => {
    try {
        const { username, password, phone_no, email_id } = req.body;
        if (!username || !password || !phone_no || !email_id) {
            const errorMessage = 'Register - Values undefined';
            return res.status(401).json({ message: errorMessage });
        }

        // Ensure password is a string
        const passwordString = password.toString();

        const db = await database.connectToDatabase();
        const usersCollection = db.collection('users');

        // Check if the username or email is already taken
        const existingUser = await usersCollection.findOne({
            $or: [
                { username: username },
                { email_id: email_id }
            ]
        });

        if (existingUser) {
            const errorMessage = 'Username or email already registered';
            console.log(errorMessage)
            return res.status(403).json({ message: errorMessage });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(passwordString, 10); // 10 is the salt rounds

        // Use aggregation to fetch the highest user_id
        const lastUser = await usersCollection.find().sort({ user_id: -1 }).limit(1).toArray();
        let newUserId = 1; // Default user_id if no users exist
        if (lastUser.length > 0) {
            newUserId = lastUser[0].user_id + 1;
        }

        // Insert the new user into the database with hashed password
        await usersCollection.insertOne({
            role_id: 5,
            reseller_id: null,
            client_id: null,
            association_id: null,
            user_id: newUserId,
            username: username,
            password: hashedPassword,
            phone_no: parseInt(phone_no),
            email_id: email_id,
            wallet_bal: 0.00,
            autostop_price: null,
            autostop_price_is_checked: null,
            autostop_time: null,
            autostop_time_is_checked: null,
            autostop_unit: null,
            autostop_unit_is_checked: null,
            tag_id: null,
            assigned_association: null,
            created_by: username,
            created_date: new Date(),
            modified_by: null,
            modified_date: null,
            status: true
        });

        // Continue with any additional logic or response
        next();

    } catch (error) {
        console.error(error);
        const errorMessage = 'Internal Server Error';
        return res.status(500).json({ message: errorMessage });
    }
};


module.exports = { authenticate, registerUser };
