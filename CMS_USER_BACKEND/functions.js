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
                collection.updateOne({ client_ip: ChargerStatus.client_ip }, { $set: { charger_status: ChargerStatus.charger_status, timestamp: new Date(chargerStatus.timestamp), error_code: ChargerStatus.error_code, modified_date : new Date() } })
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
async function handleChargingSession(chargerID, startTime, stopTime, Unitconsumed, Totalprice, user, SessionID) {
    const db = await connectToDatabase();
    const collection = db.collection('charging_session');
    let TotalUnitConsumed;

    if (Unitconsumed === null || isNaN(parseFloat(Unitconsumed))) {
        TotalUnitConsumed = "0.000";
    } else {
        TotalUnitConsumed = Unitconsumed;
    }
    const sessionPrice = isNaN(Totalprice) || Totalprice === 'NaN' ? "0.00" : parseFloat(Totalprice).toFixed(2);
    // const sessionPrice = parseFloat(price).toFixed(2);
    console.log(`Start: ${startTime}, Stop: ${stopTime}, Unit: ${TotalUnitConsumed}, Price: ${sessionPrice}`);
    // Check if a document with the same chargerID already exists in the charging_session table
    const existingDocument = await collection
        .find({ ChargerID: chargerID, ChargingSessionID: SessionID })
        .sort({ _id: -1 })
        .limit(1)
        .next();
        console.log(`TableCheck: ${JSON.stringify(existingDocument)}`);
    if (existingDocument) {
        // ChargerID exists in charging_session table
        if (existingDocument.StopTimestamp === null) {
            // StopTimestamp is null, update the existing document's StopTimestamp
            const result = await collection.updateOne({ ChargerID: chargerID, ChargingSessionID: SessionID, StopTimestamp: null }, {
                $set: {
                    StopTimestamp: stopTime !== null ? stopTime : undefined,
                    Unitconsumed: TotalUnitConsumed,
                    price: sessionPrice,
                    user: user
                }
            });

            if (result.modifiedCount > 0) {
                console.log(`ChargerID ${chargerID}: Session/StopTimestamp updated`);
                logger.info(`ChargerID ${chargerID}: Session/StopTimestamp updated`);
                const SessionPriceToUser = await updateSessionPriceToUser(user, sessionPrice);
                if (SessionPriceToUser === true) {
                    console.log(`ChargerID - ${chargerID}: Session Price updated for ${user}`);
                } else {
                    console.log(`ChargerID - ${chargerID}: Session Price Not updated for ${user}`);
                }
            } else {
                console.log(`ChargerID ${chargerID}: Session/StopTimestamp not updated`);
                logger.info(`ChargerID ${chargerID}: Session/StopTimestamp not updated`);
            }
        } else {

            const newSession = {
                ChargerID: chargerID,
                ChargingSessionID: SessionID,
                StartTimestamp: startTime !== null ? startTime : undefined,
                StopTimestamp: stopTime !== null ? stopTime : undefined,
                Unitconsumed: TotalUnitConsumed,
                price: sessionPrice,
                user: user
            };

            const result = await collection.insertOne(newSession);

            if (result.acknowledged === true) {
                console.log(`ChargerID ${chargerID}: Session/StartTimestamp inserted`);
                logger.info(`ChargerID ${chargerID}: Session/StartTimestamp inserted`);
            } else {
                console.log(`ChargerID ${chargerID}: Session/StartTimestamp not inserted`);
                logger.info(`ChargerID ${chargerID}: Session/StartTimestamp not inserted`);
            }

        }
    } else {
        // ChargerID is not in charging_session table, insert a new document
        const evDetailsDocument = await db.collection('ev_details').findOne({ ChargerID: chargerID });

        if (evDetailsDocument) {
            const newSession = {
                ChargerID: chargerID,
                ChargingSessionID: SessionID,
                StartTimestamp: startTime !== null ? startTime : undefined,
                StopTimestamp: stopTime !== null ? stopTime : undefined,
                Unitconsumed: TotalUnitConsumed,
                price: sessionPrice,
                user: user
            };

            const result = await collection.insertOne(newSession);

            if (result.acknowledged === true) {
                console.log(`ChargerID ${chargerID}: Session inserted`);
                logger.info(`ChargerID ${chargerID}: Session inserted`);
            } else {
                console.log(`ChargerID ${chargerID}: Session not inserted`);
                logger.info(`ChargerID ${chargerID}: Session not inserted`);
            }
        } else {
            console.log(`ChargerID ${chargerID}: Please add the chargerID in the database!`);
            logger.info(`ChargerID ${chargerID}: Please add the chargerID in the database!`);
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

module.exports = { savePaymentDetails, getIpAndupdateUser, generateRandomTransactionId, SaveChargerStatus, SaveChargerValue, updateTime, handleChargingSession, updateCurrentOrActiveUserToNull, getAutostop , updateChargerDetails, checkChargerIdInDatabase, checkChargerTagId, checkAuthorization, UpdateInUse};