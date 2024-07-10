const express = require('express');
const router = express.Router();
const controllers = require("./controllers.js")


//Route to Check charger ID from database
router.post('/SearchCharger', controllers.searchCharger);

//Route to end charging session
router.post('/endChargingSession', controllers.endChargingSession);

//Route to filter charger based on user preference
//getAvailableChargers
router.get('/filterChargersWithAvailableStatus', controllers.getAvailableChargers);
//getRecentSessionDetails
router.post('/getRecentSessionDetails', controllers.getRecentSessionDetails);

// Export the router
module.exports = router;