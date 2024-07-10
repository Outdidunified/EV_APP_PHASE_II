const express = require('express');
const router = express.Router();
const controllers = require("./controllers.js")

//SESSION HISTORY
//Route to Fetch specific user charging session details
router.post('/getChargingSessionDetails', controllers.getChargingSessionDetails);

//Route to fetch and send total data 
router.post('/TotalSessionData', controllers.TotalSessionData);

// Export the router
module.exports = router;