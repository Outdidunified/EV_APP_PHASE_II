const database = require('./db');

const authenticate = async(req, res, next) => {
    try {
        const email = req.body.loginUsername;
        const password = req.body.loginPassword;

        const db = await database.connectToDatabase();
        const usersCollection = db.collection('users');

        // Check if both email and password are empty
        if (!email || !password) {
            const errorMessage = 'Invalid credentials';
            return res.status(401).json({ message: errorMessage });
        }

        const user = await usersCollection.findOne({ username: email });

        if (!user || user.password !== password || user.roleID !== 1) {
            const errorMessage = 'Invalid credentials';
            return res.status(401).json({ message: errorMessage });
        }

        // Continue to the next middleware or route handler
        next();

    } catch (error) {
        console.error(error);
        const errorMessage = 'Internal Server Error';
        return res.status(500).json({ message: errorMessage });
    }
};

const registerUser = async(req, res, next) => {
    try {
        const { registerUsername, registerPassword, registerPhone } = req.body;

        if (!registerUsername || !registerPassword || !registerPhone) {
            const errorMessage = 'Register - Values undefined';
            return res.status(401).json({ message: errorMessage });
        }
        const db = await database.connectToDatabase();
        const usersCollection = db.collection('users');

        // Check if the username is already taken
        const existingUser = await usersCollection.findOne({ username: registerUsername });
        if (existingUser) {
            const errorMessage = 'Username already registered with us !';
            return res.status(403).json({ message: errorMessage });
        }

        // Insert the new user into the database
        await usersCollection.insertOne({
            username: registerUsername,
            password: registerPassword,
            phone: registerPhone,
            walletBalance: 0.00,
            role_id: 5,
            autostop_price: 1,
            autostop_price_isChecked: false,
            autostop_time: 1,
            autostop_time_isChecked: false,
            autostop_unit: 1,
            autostop_unit_isChecked: false
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