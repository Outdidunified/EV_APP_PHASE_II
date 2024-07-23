const database = require('./db');
const logger = require('./logger');
const { connectToDatabase } = require('./db');
const { wsConnections } = require('./MapModules');


// Save recharge details
async function savePaymentDetails(data) {
    const db = await database.connectToDatabase();
    const paymentCollection = db.collection('paymentDetails');
    const userCollection = db.collection('users');

    try {
        // Insert payment details
        const paymentResult = await paymentCollection.insertOne(data);

        if (!paymentResult) {
            throw new Error('Failed to save payment details');
        }

        // Update user's wallet
        const updateResult = await userCollection.updateOne({ username: data.user }, { $inc: { walletBalance: parseFloat(data.RechargeAmt) } });

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


// Fetch ip and update user
async function getIpAndupdateUser(chargerID, user) {
    try {
        const db = await database.connectToDatabase();
        const getip = await db.collection('ev_details').findOne({ ChargerID: chargerID });
        const ip = getip.ip;
        if (getip) {
            if (user !== undefined) {
                const updateResult = await db.collection('ev_details').updateOne({ ChargerID: chargerID }, { $set: { current_or_active_user: user } });

                if (updateResult.modifiedCount === 1) {
                    console.log(`Updated current_or_active_user to ${user} successfully for ChargerID ${chargerID}`);
                } else {
                    console.log(`Failed to update current_or_active_user for ChargerID ${chargerID}`);
                }
            } else {
                console.log('User is undefined - On stop there will be no user details');
            }

            return ip;
        } else {
            console.log(`GetIP Unsuccessful`);
        }
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Internal Server Error' });
    }

}

//generateRandomTransactionId function
function generateRandomTransactionId() {
    return Math.floor(1000000 + Math.random() * 9000000); // Generates a random number between 1000000 and 9999999
}

//Save the received ChargerStatus
async function SaveChargerStatus(chargerStatus) {

    const db = await connectToDatabase();
    const collection = db.collection('charger_status');
    const ChargerStatus = JSON.parse(chargerStatus);
    // Check if a document with the same chargerID already exists
    await collection.findOne({ charger_id: ChargerStatus.charger_id })
        .then(existingDocument => {
            if (existingDocument) {
                // Update the existing document
                collection.updateOne({ charger_id: ChargerStatus.charger_id }, { $set: { client_ip: ChargerStatus.client_ip,  charger_status: ChargerStatus.charger_status, timestamp: new Date(chargerStatus.timestamp), error_code: ChargerStatus.error_code, modified_date : new Date() } })
                    .then(result => {
                        if (result) {
                            console.log(`ChargerID ${ChargerStatus.charger_id}: Status successfully updated.`);
                            logger.info(`ChargerID ${ChargerStatus.charger_id}: Status successfully updated.`);
                        } else {
                            console.log(`ChargerID ${ChargerStatus.charger_id}: Status not updated`);
                            logger.info(`ChargerID ${ChargerStatus.charger_id}: Status not updated`);
                        }
                    })
                    .catch(error => {
                        console.log(`ChargerID ${ChargerStatus.charger_id}: Error occur while update the status: ${error}`);
                        logger.error(`ChargerID ${ChargerStatus.charger_id}: Error occur while update the status: ${error}`);
                    });

            } else {

                db.collection('charger_details').findOne({ charger_id: ChargerStatus.charger_id }) // changed 08/12
                    .then(foundDocument => {
                        if (foundDocument) {
                            ChargerStatus.charger_id = foundDocument.charger_id;

                            collection.insertOne(ChargerStatus)
                                .then(result => {
                                    if (result) {
                                        console.log(`ChargerID ${ChargerStatus.charger_id}: Status successfully inserted.`);
                                    } else {
                                        console.log(`ChargerID ${ChargerStatus.charger_id}: Status not inserted`);
                                    }
                                })
                                .catch(error => {
                                    console.log(`ChargerID ${ChargerStatus.charger_id}: Error occur while insert the status: ${error}`);
                                });

                        } else {
                            console.log('Document not found in ChargerStatusSave function');
                        }
                    })
            }
        })
        .catch(error => {
            console.log(error);
        });
}

//Save the received ChargerValue
async function SaveChargerValue(ChargerVal) {

    const db = await connectToDatabase();
    const collection = db.collection('charger_meter_values');
    const ChargerValue = JSON.parse(ChargerVal);
    console.log(ChargerValue)

    await db.collection('charger_details').findOne({ charger_id: ChargerValue.charger_id })
        .then(foundDocument => {
            if (foundDocument) {
                ChargerValue.chargerID = foundDocument.ChargerID; // Assuming ChargerID is the correct field name
                collection.insertOne(ChargerValue)
                    .then(result => {
                        if (result) {
                            console.log(`ChargerID ${ChargerValue.chargerID}: Value successfully inserted.`);
                            logger.info(`ChargerID ${ChargerValue.chargerID}: Value successfully inserted.`);
                        } else {
                            console.log(`ChargerID ${ChargerValue.chargerID}: Value not inserted`);
                            logger.error(`ChargerID ${ChargerValue.chargerID}: Value not inserted`);
                        }
                    })
                    .catch(error => {
                        console.log(`ChargerID ${ChargerValue.chargerID}: An error occurred while inserting the value: ${error}.`);
                        logger.info(`ChargerID ${ChargerValue.chargerID}: An error occurred while inserting the value: ${error}.`);
                    });
            } else {
                console.log(`ChargerID ${ChargerValue.chargerID}: Value not available in the ChargerSavevalue function`);
                logger.info(`ChargerID ${ChargerValue.chargerID}: Value not available in the ChargerSavevalue function`);
            }
        })

}

//update time while while receive message from ws
async function updateTime(charger_id) {
    const db = await connectToDatabase();
    const evDetailsCollection = db.collection('charger_details');
    const collection = db.collection('charger_status');
    const unregisteredDevicesCollection = db.collection('UnRegister_Devices');

    // Correct the query to pass an object with charger_id as a key
    const deviceExists = await evDetailsCollection.findOne({charger_id });

    if (deviceExists) {
        const filter = { charger_id };
        const update = { $set: { timestamp: new Date() } };
        const result = await collection.updateOne(filter, update);

        if (result.modifiedCount === 1) {
            console.log(`The time for ChargerID ${charger_id} has been successfully updated.`);
            logger.info(`The time for ChargerID ${charger_id} has been successfully updated.`);
        } else {
            console.log(`ChargerID ${charger_id} not found to update time`);
            logger.error(`ChargerID ${charger_id} not found to update time`);
            const deleteUnRegDev = await unregisteredDevicesCollection.deleteOne({ charger_id });
            if (deleteUnRegDev.deletedCount === 1) {
                console.log(`UnRegisterDevices - ${charger_id} has been deleted.`);
            } else {
                console.log(`Failed to delete UnRegisterDevices - ${charger_id}.`);
            }
        }

        return true;
    } else {
        // Device_ID does not exist in ev_details collection
        console.log(`ChargerID ${charger_id} does not exist in the database.`);
        logger.error(`ChargerID ${charger_id} does not exist in the database.`);

        const unregisteredDevice = await unregisteredDevicesCollection.findOne({ charger_id });

        if (unregisteredDevice) {
            // Device already exists in UnRegister_Devices, update its current time
            const filter = { charger_id };
            const update = { $set: { LastUpdateTime: new Date() } };
            await unregisteredDevicesCollection.updateOne(filter, update);
            console.log(`UnRegisterDevices - ${charger_id} LastUpdateTime Updated.`);
        } else {
            // Device does not exist in UnRegister_Devices, insert it with the current time
            await unregisteredDevicesCollection.insertOne({ charger_id, LastUpdateTime: new Date() });
            console.log(`UnRegisterDevices - ${charger_id} inserted.`);
        }

        // Delete the unregistered charger after updating or inserting
        const deleteUnRegDev = await unregisteredDevicesCollection.deleteOne({ charger_id });
        if (deleteUnRegDev.deletedCount === 1) {
            console.log(`UnRegisterDevices - ${charger_id} has been deleted.`);
        } else {
            console.log(`Failed to delete UnRegisterDevices - ${charger_id}.`);
        }

        return false;
    }
}

//insert charging session into the database
async function handleChargingSession(charger_id, startTime, stopTime, Unitconsumed, Totalprice, user, SessionID) {
    const db = await connectToDatabase();
    const collection = db.collection('device_session_details');
    let TotalUnitConsumed;
    if (Unitconsumed === null || isNaN(parseFloat(Unitconsumed))) {
        TotalUnitConsumed = "0.000";
    } else {
        TotalUnitConsumed = Unitconsumed;
    }
    const sessionPrice = isNaN(Totalprice) || Totalprice === 'NaN' ? "0.00" : parseFloat(Totalprice).toFixed(2);
    console.log(`Start: ${startTime}, Stop: ${stopTime}, Unit: ${TotalUnitConsumed}, Price: ${sessionPrice}`);
    console.log(user)
    // Check if a document with the same chargerID already exists in the charging_session table
    const existingDocument = await collection
        .find({ charger_id: charger_id, session_id: SessionID })
        .sort({ _id: -1 })
        .limit(1)
        .next();
    console.log(`TableCheck: ${JSON.stringify(existingDocument)}`);

    if (existingDocument) {
        if (existingDocument.stop_time === null) {
            const result = await collection.updateOne({ charger_id: charger_id, session_id: SessionID, stop_time: null }, {
                $set: {
                    stop_time: stopTime !== null ? stopTime : undefined,
                    unit_consummed: TotalUnitConsumed,
                    price: sessionPrice,
                    user: user
                }
            });

            if (result.modifiedCount > 0) {
                console.log(`ChargerID ${charger_id}: Session/StopTimestamp updated`);
                logger.info(`ChargerID ${charger_id}: Session/StopTimestamp updated`);
                const SessionPriceToUser = await updateSessionPriceToUser(user, sessionPrice);
                if (SessionPriceToUser === true) {
                    console.log(`ChargerID - ${charger_id}: Session Price updated for ${user}`);
                } else {
                    console.log(`ChargerID - ${charger_id}: Session Price Not updated for ${user}`);
                }
            } else {
                console.log(`ChargerID ${charger_id}: Session/StopTimestamp not updated`);
                logger.info(`ChargerID ${charger_id}: Session/StopTimestamp not updated`);
            }
        } else {
            const newSession = {
                charger_id: charger_id,
                session_id: SessionID,
                start_time: startTime !== null ? startTime : undefined,
                stop_time: stopTime !== null ? stopTime : undefined,
                unit_consummed: TotalUnitConsumed,
                price: sessionPrice,
                user: user,
                created_date: new Date()
            };

            const result = await collection.insertOne(newSession);

            if (result.acknowledged === true) {
                console.log(`ChargerID ${charger_id}: Session/StartTimestamp inserted`);
                logger.info(`ChargerID ${charger_id}: Session/StartTimestamp inserted`);
            } else {
                console.log(`ChargerID ${charger_id}: Session/StartTimestamp not inserted`);
                logger.info(`ChargerID ${charger_id}: Session/StartTimestamp not inserted`);
            }
        }
    } else {
        // ChargerID is not in device_session_details table, insert a new document
        try {
            const evDetailsDocument = await db.collection('charger_details').findOne({ charger_id: charger_id });
            if (evDetailsDocument) {
                const newSession = {
                    charger_id: charger_id,
                    session_id: SessionID,
                    start_time: startTime !== null ? startTime : undefined,
                    stop_time: stopTime !== null ? stopTime : undefined,
                    unit_consummed: TotalUnitConsumed,
                    price: sessionPrice,
                    user: user,
                    created_date: new Date()
                };

                const result = await collection.insertOne(newSession);
                console.log(result)
                if (result.acknowledged === true) {
                    console.log(`ChargerID ${charger_id}: Session inserted`);
                    logger.info(`ChargerID ${charger_id}: Session inserted`);
                } else {
                    console.log(`ChargerID ${charger_id}: Session not inserted`);
                    logger.info(`ChargerID ${charger_id}: Session not inserted`);
                }
            } else {
                console.log(`ChargerID ${charger_id}: Please add the chargerID in the database!`);
                logger.info(`ChargerID ${charger_id}: Please add the chargerID in the database!`);
            }
        } catch (error) {
            console.error(`Error querying device_session_details: ${error.message}`);
        }
    }
}


//update charging session with user
async function updateSessionPriceToUser(user, price) {
    try {
        const sessionPrice = parseFloat(price).toFixed(2);
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        const userDocument = await usersCollection.findOne({ username: user });

        if (userDocument) {
            const updatedWalletBalance = (userDocument.walletBalance - sessionPrice).toFixed(2);
            // Check if the updated wallet balance is NaN
            if (!isNaN(updatedWalletBalance)) {
                const result = await usersCollection.updateOne({ username: user }, { $set: { walletBalance: parseFloat(updatedWalletBalance) } });

                if (result.modifiedCount > 0) {
                    console.log(`Wallet balance updated for user ${user}.`);
                    return true;
                } else {
                    console.log(`Wallet balance not updated for user ${user}.`);
                    return false;
                }
            } else {
                console.log(`Invalid updated wallet balance for user ${user}.`);
                return false; // Indicate invalid balance
            }
        } else {
            console.log(`User not found with username ${user}.`);
        }

    } catch (error) {
        console.error('Error in updateSessionPriceToUser:', error);
    }
}

//update current or active user to null
async function updateCurrentOrActiveUserToNull(uniqueIdentifier) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection('charger_details');
        const result = await collection.updateOne({ charger_id: uniqueIdentifier }, { $set: { current_or_active_user: null } });

        if (result.modifiedCount === 0) {
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error while update CurrentOrActiveUser To Null:', error);
        return false;
    }
}

async function updateChargerDetails(charger_id, updateData) {
    try {
        const db = await database.connectToDatabase();
        const collection = db.collection('charger_details');

        const result = await collection.updateOne(
            { charger_id: charger_id },
            { $set: updateData }
        );

        return result.modifiedCount > 0;
    } catch (error) {
        console.error('Error updating charger details:', error);
        return false;
    } 
}

const checkChargerIdInDatabase = async (charger_id) => {
    try {
        const db = await database.connectToDatabase();
        const collection = db.collection('charger_details');
        const charger = await collection.findOne({ charger_id: charger_id });
        if (!charger) {
            return false;
        }
        return true;
    } catch (error) {
        console.error('Database error:', error);
        return false;
    } 
};

const checkChargerTagId = async (charger_id) => {
    try {
        const db = await database.connectToDatabase();
        const collection = db.collection('charger_details');
        const charger = await collection.findOne({ charger_id: charger_id }, { projection: { tag_id: 1 } });

        if (!charger || charger.tag_id === null) {
            return 'Pending';
        }
        return 'Accepted';
    } catch (error) {
        console.error('Database error:', error);
        return 'Rejected';
    }
};

const UpdateInUse = async (tagId, value) => {
    try {
        const db = await database.connectToDatabase();
        const tagIdCollection = db.collection('tag_id'); // Assuming the collection name is 'tag_id'
        const updateResult = await tagIdCollection.updateOne({ tag_id: tagId }, { $set: { in_use: value } });

        if (updateResult.matchedCount === 0) {
            console.log(`Tag ID ${tagId} not found`);
        } else if (updateResult.modifiedCount === 0) {
            console.log(`Tag ID ${tagId} found but the 'in_use' value was already ${value}`);
        } else {
            console.log(`Tag ID ${tagId} successfully updated to 'in_use' value: ${value}`);
        }
    } catch (error) {
        console.error('Database error:', error);
    }
};


async function checkAuthorization(charger_id, idTag) {
    try {
        const db = await connectToDatabase();
        const chargerDetailsCollection = db.collection('charger_details');
        const tagIdCollection = db.collection('tag_id'); // Assuming the collection name is 'tag_id'
        
        // Fetch charger details
        const chargerDetails = await chargerDetailsCollection.findOne({ charger_id });

        if (chargerDetails && chargerDetails.tag_id === idTag) {
            // Fetch tag_id details from the separate collection
            const tagIdDetails = await tagIdCollection.findOne({ tag_id: idTag });

            if (tagIdDetails) {
                const expiryDate = new Date(tagIdDetails.tag_id_expiry_date);
                const currentDate = new Date();
                
                if (tagIdDetails.status === false) {
                    return { status: "Blocked", expiryDate: expiryDate.toISOString() };
                } else if (expiryDate < currentDate){
                    return { status: "Expired", expiryDate: expiryDate.toISOString() };
                } else if (tagIdDetails.in_use === true){
                    return { status: "ConcurrentTx" , expiryDate: expiryDate.toISOString() };
                }  else {

                    return { status: "Accepted", expiryDate: expiryDate.toISOString() };
                }
            } else {
                return { status: "Invalid"};
            }
        }else{
            return { status: "Invalid"};
        }
    } catch (error) {
        console.error(`Error checking tag_id for charger_id ${charger_id}:`, error);
        return "Error";
    }
}

// Function to calculate the difference between two sets of MeterValues
async function calculateDifference(startValues, lastValues,uniqueIdentifier) {
    const startEnergy = startValues || 0;
    const lastEnergy = lastValues || 0;
    console.log(startEnergy, lastEnergy);
    const differ = lastEnergy - startEnergy;
    let calculatedUnit = parseFloat(differ / 1000).toFixed(3);
    let unit;
    if (calculatedUnit === null || isNaN(parseFloat(calculatedUnit))) {
        unit = 0;
    } else {
        unit = calculatedUnit;
    }
    console.log(`Unit: ${unit}`);
    const sessionPrice = await calculatePrice(unit, uniqueIdentifier);
    const formattedSessionPrice = isNaN(sessionPrice) || sessionPrice === 'NaN' ? 0 : parseFloat(sessionPrice).toFixed(2);
    return { unit, sessionPrice: formattedSessionPrice };
}

async function getUsername(chargerID) {
    try {
        const db = await connectToDatabase();
        const evDetailsCollection = db.collection('charger_details');
        const chargerDetails = await evDetailsCollection.findOne({ charger_id: chargerID });
        if (!chargerDetails) {
            console.log('getUsername - Charger ID not found in the database');
        }
        if (!chargerDetails) {
            console.log('getUsername - Charger ID not found in the database');
        }
        const username = chargerDetails.current_or_active_user;
        return username;
    } catch (error) {
        console.error('Error getting username:', error);
    }
}
async function getAutostop(user){
    try{
        const db = await database.connectToDatabase();
        const autoTimeVal = await db.collection('users').findOne({ username: user });
        
        const time_val = autoTimeVal.autostop_time;
        const isTimeChecked = autoTimeVal.autostop_time_is_checked;
        const unit_val = autoTimeVal.autostop_unit;
        const isUnitChecked = autoTimeVal.autostop_unit_is_checked;
        const price_val = autoTimeVal.autostop_price;
        const isPriceChecked = autoTimeVal.autostop_price_is_checked;

        console.log(`getAutostop_time: ${time_val} & ${isTimeChecked}, getAutostop_unit: ${unit_val} & ${isUnitChecked}, getAutostop_price: ${price_val} & ${isPriceChecked}`);

        return { 'time_value': time_val, 'isTimeChecked': isTimeChecked, 'unit_value': unit_val, 'isUnitChecked': isUnitChecked, 'price_value': price_val, 'isPriceChecked': isPriceChecked };

    }catch(error){
        console.error(error);
        return false;
    }
}


async function captureMetervalues(Identifier, requestData, uniqueIdentifier, UniqueChargingsessionId) {
    const sendTo = wsConnections.get(uniqueIdentifier);
    const response = [3, Identifier, {}];
    sendTo.send(JSON.stringify(response));

    let measurand;
    let value;
    let EnergyValue;

    const meterValueArray = requestData[3].meterValue[0].sampledValue;
    const keyValuePair = {};
    meterValueArray.forEach((sampledValue) => {
        measurand = sampledValue.measurand;
        value = sampledValue.value;
        keyValuePair[measurand] = value;
        if (measurand === 'Energy.Active.Import.Register') {
            EnergyValue = value;
        }
    });

    const currentTime = new Date().toISOString();
    keyValuePair.timestamp = currentTime;
    keyValuePair.client_ip = clientIpAddress;
    keyValuePair.session_id = UniqueChargingsessionId;
    keyValuePair.created_date = currentTime;

    const ChargerValue = JSON.stringify(keyValuePair);
    await SaveChargerValue(ChargerValue);
    await updateTime(uniqueIdentifier);
    if (keyValuePair['Energy.Active.Import.Register'] !== undefined) {
        return EnergyValue;
    }
    return undefined;
}

async function autostop_unit(firstMeterValues,lastMeterValues,autostopSettings,uniqueIdentifier){

    const startEnergy = firstMeterValues || 0;
    const lastEnergy = lastMeterValues || 0;
    
    const result = lastEnergy - startEnergy;
    let calculatedUnit = parseFloat(result / 1000).toFixed(3);

    console.dir(autostopSettings);
    console.log(`${autostopSettings.unit_value},${calculatedUnit}`);

    if (autostopSettings.unit_value && autostopSettings.isUnitChecked === true) {
        if(autostopSettings.unit_value <= calculatedUnit){
            console.log(`Charger ${uniqueIdentifier} stop initiated - auto stop unit`);
            const ip = await getIpAndupdateUser(uniqueIdentifier);
            const result = await chargerStopCall(uniqueIdentifier, ip);
            if (result === true) {
                console.log(`AutoStop unit: Charger Stopped !`);
            } else {
                console.log(`Error: ${result}`);
            }
        }
    }

    console.log(`${lastEnergy} - ${startEnergy} - ${result}`);
}

async function autostop_price(firstMeterValues,lastMeterValues,autostopSettings,uniqueIdentifier){

    const startEnergy = firstMeterValues || 0;
    const lastEnergy = lastMeterValues || 0;
    let unit;
    
    const result = lastEnergy - startEnergy;
    let calculatedUnit = parseFloat(result / 1000).toFixed(3);

    if (calculatedUnit === null || isNaN(calculatedUnit)) {
        unit = 0;
    } else {
        unit = calculatedUnit;
    }
    console.log(`Unit: ${unit}`);
    const sessionPrice = await calculatePrice(unit, uniqueIdentifier);
    const formattedSessionPrice = isNaN(sessionPrice) || sessionPrice === 'NaN' ? 0 : parseFloat(sessionPrice).toFixed(2);
    

    console.log(`${autostopSettings.price_value} - ${formattedSessionPrice}`);

    if (autostopSettings.price_value && autostopSettings.isPriceChecked === true) {
        if(autostopSettings.price_value <= formattedSessionPrice){
            console.log(`Charger ${uniqueIdentifier} stop initiated - auto stop price`);
            const ip = await getIpAndupdateUser(uniqueIdentifier);
            const result = await chargerStopCall(uniqueIdentifier, ip);
            if (result === true) {
                console.log(`AutoStop price: Charger Stopped !`);
            } else {
                console.log(`Error: ${result}`);
            }
        }
    }
}

module.exports = {  savePaymentDetails, 
                    getIpAndupdateUser, 
                    generateRandomTransactionId, 
                    SaveChargerStatus, 
                    SaveChargerValue, 
                    updateTime, 
                    updateCurrentOrActiveUserToNull, 
                    getAutostop ,
                    updateChargerDetails, 
                    checkChargerIdInDatabase, 
                    checkChargerTagId,
                    checkAuthorization,
                    UpdateInUse, 
                    calculateDifference,
                    handleChargingSession, 
                    getUsername,
                    captureMetervalues,
                    autostop_unit,
                    autostop_price,
                };