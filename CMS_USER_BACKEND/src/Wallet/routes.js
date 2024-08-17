const express = require('express');
const router = express.Router();
const controllers = require("./controllers.js")



// Route to fetch user wallet balance
router.post('/FetchWalletBalance', async (req, res) => {
    try {
        await controllers.FetchWalletBalance(req, res);
    } catch (error) {
        console.error('Error in FetchWalletBalance route:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


//PHONE PAY Route 
const Razorpay = require('razorpay');
const razorpay = new Razorpay({
    key_id: 'rzp_test_dcep4q6wzcVYmr',
    key_secret: 'rHIO1cbZR2fCuh7XivS9xWBE'
});


//Route to Call phonepe API to recharge
router.get('/pay', async function (req, res, next) {
    try {
        const RCuser = req.query.RCuser;
        const RCamt = parseInt(req.query.amount);
        let result = RCamt * 100;
        let tx_uuid = uniqid();
        let normalPayLoad = {
            "merchantId": process.env.merchantId,
            "merchantTransactionId": tx_uuid,
            "merchantUserId": process.env.merchantUserId,
            "amount": result,
            "redirectUrl": `http://122.166.210.142:4455/pay-return-url?user=${RCuser}`,
            "redirectMode": "POST",
            "callbackUrl": `http://122.166.210.142:4455/pay-return-url?user=${RCuser}`,
            "bankId": "SBIN",
            "paymentInstrument": {
                "type": "PAY_PAGE"
            }
        }
        let saltKey = process.env.saltKey;
        let saltIndex = process.env.saltIndex;
        let bufferObj = Buffer.from(JSON.stringify(normalPayLoad), "utf8");
        let base64String = bufferObj.toString("base64");
        let string = base64String + '/pg/v1/pay' + saltKey;
        let sha256_val = sha256(string);
        let checksum = sha256_val + '###' + saltIndex;
        axios.post(process.env.paymentURL, {
            'request': base64String
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': checksum,
                'accept': 'application/json'
            }
        }).then(function (response) {
            res.redirect(response.data.data.instrumentResponse.redirectInfo.url);
        }).catch(function (error) {
            console.log(error);
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});
// Route to Return phonepe API after recharge
router.all('/pay-return-url', async function (req, res) {
    const parsedUrl = url.parse(req.url, true);
    const queryParams = parsedUrl.query;
    const user = queryParams.user;
    if (req.body.code == 'PAYMENT_SUCCESS' && req.body.merchantId && req.body.transactionId && req.body.providerReferenceId) {
        if (req.body.transactionId) {
            let saltKey = process.env.saltKey;
            let saltIndex = process.env.saltIndex;
            let surl = process.env.paymentURLStatus + req.body.transactionId;
            let string = '/pg/v1/status/PGTESTPAYUAT/' + req.body.transactionId + saltKey;
            let sha256_val = sha256(string);
            let checksum = sha256_val + '###' + saltIndex;
            axios.get(surl, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-VERIFY': checksum,
                    'X-MERCHANT-ID': req.body.transactionId,
                    'accept': 'application/json'
                }
            }).then(async function (response) {
                const result = await controllers.savePaymentDetails(response.data, user);
                if (result === true) {
                    return res.status(200).redirect('/PaymentSuccess');
                } else {
                    return res.status(400).redirect('/PaymentUnsuccess');
                }
            }).catch(function (error) {
                console.log(error);
            });
        } else {
            console.log("Sorry!! Error1");
        }
    } else {
        console.log(req.body);
    }
});
router.post('/createOrder', async (req, res) => {
    const options = {
        amount: req.body.amount * 100, // amount in the smallest currency unit
        currency: req.body.currency,
        receipt: 'receipt_order_01'
    };

    try {
        const response = await razorpay.orders.create(options);
        res.json(response);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/savePayments', async (req, res) => {
    try {
        const result = await controllers.savePaymentDetails(req.body);
        if (result === true) {
            res.json(1);
        } else {
            res.json(0);
        }
    } catch (error) {
        console.log(error);
    }
});


//Route to Fetch specific user wallet deduction and wallet recharge history
router.post('/getTransactionDetails', async function(req, res) {
    try {
        const { username } = req.body;

        if (!username) {
            const errorMessage = 'TransactionDetails - Username undefined!';
            return res.status(401).json({ message: errorMessage });
        }

        const { success, data, message } = await controllers.getTransactionDetails(username);
        if (success) {
            return res.status(200).json({ value: data });
        } else {
            return res.status(500).json({ message: message });
        }

    } catch (error) {
        console.error('Error in getTransactionDetails route:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Export the router
module.exports = router;