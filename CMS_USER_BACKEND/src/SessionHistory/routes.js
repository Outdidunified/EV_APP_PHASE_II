const express = require('express');
const router = express.Router();
const controllers = require("./controllers.js")


//Route to Fetch specific user charging session details
router.post('/getChargingSessionDetails', controllers.getChargingSessionDetails);

router.post('/TotalSessionData', controllers.TotalSessionData);

// Export the router
module.exports = router;