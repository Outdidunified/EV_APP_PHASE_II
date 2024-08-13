const database = require('../../db');
const logger = require('../../logger');

//RECHARGE DATA
// Save recharge details
async function savePaymentDetails(data) {
    const db = await database.connectToDatabase();
    const paymentCollection = db.collection('paymentDetails');
    const userCollection = db.collection('users');

    try {
        // Fetch the last payment id
        const lastPayment = await paymentCollection.find().sort({ payment_id: -1 }).limit(1).toArray();
        let newPaymentId = 1; // Default if no payments exist

        if (lastPayment.length > 0) {
            newPaymentId = lastPayment[0].payment_id + 1;
        }

        // Insert payment details with incremented payment_id
        const paymentResult = await paymentCollection.insertOne({
            user: data.user,
            payment_id: newPaymentId,
            recharge_amount: data.RechargeAmt,
            transaction_id: data.transactionId,
            response: data.responseCode,
            recharged_date: new Date(data.date_time),
            recharged_by: data.user,
        });

        if (!paymentResult) {
            throw new Error('Failed to save payment details');
        }

        // Update user's wallet
        const updateResult = await userCollection.updateOne({ username: data.user }, { $inc: { wallet_bal: parseFloat(data.RechargeAmt) } });
        if (updateResult.modifiedCount === 1) {
            return true;
        } else {
            throw new Error('Failed to update user wallet');
        }
    } catch (error) {
        console.error(error.message);
        return false;
    }
}

//WALLET BALANCE
//FetchWalletBalance
async function FetchWalletBalance(req, res) {
    const { user_id } = req.body;

    try {
        if (!user_id) {
            return res.status(400).json({ message: 'User ID is required' });
        }

        const db = await database.connectToDatabase();
        const usersCollection = db.collection("users");
        
        // Query to fetch the user by user_id
        const user = await usersCollection.findOne({ user_id: user_id, status: true });

        if (!user) {
            return res.status(404).json({ message: 'User not found or inactive' });
        }

        // return res.status(200).json({ status: 'Success', data: user.wallet_bal });
        return res.status(200).json({ status: 'Success', data: user.wallet_bal });

    } catch (error) {
        console.error(`Error fetching wallet balance: ${error}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

//TRANSACTION HISTORY
//getTransactionDetails
async function getTransactionDetails(username) {
    try {
        const db = await database.connectToDatabase();
        const CharSessionCollection = db.collection('device_session_details');
        const walletTransCollection = db.collection('paymentDetails');

        // Query charging_session collection and sort by StopTimestamp
        const chargingSessionResult = await CharSessionCollection.find({ user: username }).toArray();

        // Query paymentDetails collection and sort by date_time
        const paymentDetailsResult = await walletTransCollection.find({ user: username }).toArray();

        if (chargingSessionResult.length || paymentDetailsResult.length) {
            // Add 'type' field to indicate credit
            const deducted = chargingSessionResult
                .filter(session => session.StopTimestamp !== null)
                .map(session => ({ status: 'Deducted', amount: session.price, time: session.stop_time }));

            // Add 'type' field to indicate deducted
            const credits = paymentDetailsResult.map(payment => ({ status: 'Credited', amount: payment.recharge_amount, time: payment.recharged_date }));

            // Combine both sets of documents into one array
            let mergedResult = [...credits, ...deducted];

            // Sort the merged array by timestamp
            mergedResult.sort((a, b) => {
                const timestampA = new Date(a.time);
                const timestampB = new Date(b.time);
                return timestampB - timestampA; // Sort in descending order by timestamp
            });

            const finalResult = mergedResult.map(item => ({ status: item.status, amount: item.amount, time: item.time }));
            return { success: true, data: finalResult };
        } else {
            return { success: true, data: [], message: 'No Record Found !' };
        }

    } catch (error) {
        console.error('Error fetching transaction details:', error);
        return { success: false, message: 'Internal Server Error' };
    }
}


module.exports = {
    //RECHARGE DATA
    savePaymentDetails,
    //WALLET BALANCE
    FetchWalletBalance,
    //TRANSACTION HISTORY
    getTransactionDetails,
};