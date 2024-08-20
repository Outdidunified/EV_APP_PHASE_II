const database = require('./db');
const logger = require('./logger');
const { connectToDatabase } = require('./db');
const { wsConnections } = require('./MapModules');
const Chargercontrollers = require("./src/ChargingSession/controllers.js");


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


// Fetch IP and update user for a specific connector
async function getIpAndupdateUser(chargerID, user, connectorId) {
    try {
        const db = await database.connectToDatabase();
        const chargerDetails = await db.collection('charger_details').findOne({ charger_id: chargerID });

        if (!chargerDetails) {
            console.log(`GetIP Unsuccessful - ChargerID ${chargerID} not found`);
            return null;
        }

        const ip = chargerDetails.ip;
        const connectorField = `current_or_active_user_for_connector_${connectorId}`;

        if (user !== undefined) {
            const updateResult = await db.collection('charger_details').updateOne(
                { charger_id: chargerID },
                { $set: { [connectorField]: user } }
            );

            if (updateResult.modifiedCount === 1) {
                console.log(`Updated ${connectorField} to ${user} successfully for ChargerID ${chargerID}`);
            } else {
                console.log(`Failed to update ${connectorField} for ChargerID ${chargerID}`);
            }
        } else {
            console.log('User is undefined - On stop there will be no user details');
        }

        return ip;
    } catch (error) {
        console.error(error);
        throw new Error('Internal Server Error');
    }
}


//generateRandomTransactionId function
function generateRandomTransactionId() {
    return Math.floor(1000000 + Math.random() * 9000000); // Generates a random number between 1000000 and 9999999
}

//Save the received ChargerStatus
async function SaveChargerStatus(chargerStatus, connectorId) {
    const db = await connectToDatabase();
    const collection = db.collection('charger_status');
    const ChargerStatus = JSON.parse(chargerStatus);
    ChargerStatus.connector_id = connectorId; // Add the connectorId to the ChargerStatus object

    // Check if a document with the same chargerID and connectorId already exists
    await collection.findOne({ charger_id: ChargerStatus.charger_id, connector_id: connectorId })
        .then(existingDocument => {
            if (existingDocument) {
                // Update the existing document
                collection.updateOne(
                    { charger_id: ChargerStatus.charger_id, connector_id: connectorId },
                    {
                        $set: {
                            client_ip: ChargerStatus.client_ip,
                            connector_type: ChargerStatus.connector_type,
                            charger_status: ChargerStatus.charger_status,
                            timestamp: new Date(ChargerStatus.timestamp),
                            error_code: ChargerStatus.error_code,
                            modified_date: new Date()
                        }
                    }
                )
                .then(result => {
                    if (result) {
                        console.log(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Status successfully updated.`);
                        logger.info(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Status successfully updated.`);
                    } else {
                        console.log(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Status not updated.`);
                        logger.info(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Status not updated.`);
                    }
                })
                .catch(error => {
                    console.log(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Error occur while updating the status: ${error}`);
                    logger.error(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Error occur while updating the status: ${error}`);
                });

            } else {
                db.collection('charger_details').findOne({ charger_id: ChargerStatus.charger_id })
                    .then(foundDocument => {
                        if (foundDocument) {
                            ChargerStatus.charger_id = foundDocument.charger_id;

                            collection.insertOne(ChargerStatus)
                                .then(result => {
                                    if (result) {
                                        console.log(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Status successfully inserted.`);
                                    } else {
                                        console.log(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Status not inserted.`);
                                    }
                                })
                                .catch(error => {
                                    console.log(`ChargerID ${ChargerStatus.charger_id}, ConnectorID ${connectorId}: Error occur while inserting the status: ${error}`);
                                });
                        } else {
                            console.log('Document not found in ChargerStatusSave function');
                        }
                    });
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
                ChargerValue.charger_id = foundDocument.charger_id; // Assuming ChargerID is the correct field name
                collection.insertOne(ChargerValue)
                    .then(result => {
                        if (result) {
                            console.log(`ChargerID ${ChargerValue.charger_id}: Value successfully inserted.`);
                            logger.info(`ChargerID ${ChargerValue.charger_id}: Value successfully inserted.`);
                        } else {
                            console.log(`ChargerID ${ChargerValue.charger_id}: Value not inserted`);
                            logger.error(`ChargerID ${ChargerValue.charger_id}: Value not inserted`);
                        }
                    })
                    .catch(error => {
                        console.log(`ChargerID ${ChargerValue.charger_id}: An error occurred while inserting the value: ${error}.`);
                        logger.info(`ChargerID ${ChargerValue.charger_id}: An error occurred while inserting the value: ${error}.`);
                    });
            } else {
                console.log(`ChargerID ${ChargerValue.charger_id}: Value not available in the ChargerSavevalue function`);
                logger.info(`ChargerID ${ChargerValue.charger_id}: Value not available in the ChargerSavevalue function`);
            }
        })

}

//update time while while receive message from ws
async function updateTime(charger_id, connectorId) {
    const db = await connectToDatabase();
    const evDetailsCollection = db.collection('charger_details');
    const chargerStatusCollection = db.collection('charger_status');
    const unregisteredDevicesCollection = db.collection('UnRegister_Devices');

    // Check if the device exists in the charger_details collection
    const deviceExists = await evDetailsCollection.findOne({ charger_id });

    if (deviceExists) {
        // Update timestamp for the specific charger_id and connectorId
        const filter = { charger_id };
        const update = { $set: { timestamp: new Date() } };
        const result = await chargerStatusCollection.updateOne(filter, update);

        if (result.modifiedCount === 1) {
            console.log(`The time for ChargerID ${charger_id} has been successfully updated.`);
            logger.info(`The time for ChargerID ${charger_id} has been successfully updated.`);
        } else {
            console.log(`ChargerID ${charger_id} not found to update time.`);
            logger.error(`ChargerID ${charger_id} not found to update time.`);
        }

        return true;
    } else {
        // Device_ID does not exist in charger_details collection
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

        // Optionally, delete the unregistered charger after updating or inserting
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
async function handleChargingSession(charger_id, connectorId,startTime, stopTime, Unitconsumed, Totalprice, user, SessionID, connectorTypeValue) {
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
    // Check if a document with the same chargerID already exists in the charging_session table
    const existingDocument = await collection
        .find({ charger_id: charger_id, session_id: SessionID, connector_id: connectorId, connector_type: connectorTypeValue })
        .sort({ _id: -1 })
        .limit(1)
        .next();
    console.log(`TableCheck: ${JSON.stringify(existingDocument)}`);

    if (existingDocument) {
        if (existingDocument.stop_time === null) {
            const result = await collection.updateOne({ charger_id: charger_id,connector_id: connectorId, session_id: SessionID, stop_time: null }, {
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
                connector_id: connectorId,
                connector_type: connectorTypeValue,
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
                    connector_id: connectorId,
                    connector_type: connectorTypeValue,
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
            const updatedWalletBalance = (userDocument.wallet_bal - sessionPrice).toFixed(2);
            // Check if the updated wallet balance is NaN
            if (!isNaN(updatedWalletBalance)) {
                const result = await usersCollection.updateOne({ username: user }, { $set: { wallet_bal: parseFloat(updatedWalletBalance) } });

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

// Update current or active user to null for a specific connector
async function updateCurrentOrActiveUserToNull(uniqueIdentifier, connectorId) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection('charger_details');
        const updateField = `current_or_active_user_for_connector_${connectorId}`;
        const updateObject = { $set: { [updateField]: null } };

        const result = await collection.updateOne({ charger_id: uniqueIdentifier }, updateObject);

        if (result.modifiedCount === 0) {
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error while updating CurrentOrActiveUser to null:', error);
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

const checkChargerTagId = async (charger_id, connector_id) => {
    try {
        const db = await database.connectToDatabase();
        const collection = db.collection('charger_details');

        // Dynamically build the projection field name based on the connector_id
        const projectionField = `tag_id_for_connector_${connector_id}`;
        
        const charger = await collection.findOne(
            { charger_id: charger_id },
            { projection: { [projectionField]: 1 } }
        );

        if (!charger || charger[projectionField] === null) {
            return 'Pending';
        }
        return 'Accepted';
    } catch (error) {
        console.error('Database error:', error);
        return 'Rejected';
    }
};

const UpdateInUse = async (charger_id, idTag, connectorId) => {
    try {
        const db = await database.connectToDatabase();
        const chargerDetailsCollection = db.collection('charger_details'); // Assuming the collection name is 'charger_details'

        // Construct the dynamic field name for the specific connector
        const connectorTagIdField = `tag_id_for_connector_${connectorId}`;
        const connectorTagIdInUseField = `tag_id_for_connector_${connectorId}_in_use`;

        // Fetch the specific connector's tag ID from the charger details
        const chargerDetails = await chargerDetailsCollection.findOne(
            { charger_id: charger_id },
            { projection: { [connectorTagIdField]: 1, [connectorTagIdInUseField]: 1 } }
        );

        // Check if the tag ID exists and matches the provided idTag
        if (!chargerDetails || chargerDetails[connectorTagIdField] !== idTag) {
            console.log(`Tag ID ${idTag} not found for connector ${connectorId} on charger ${charger_id}`);
            return;
        }

        // Create the update field to set 'tag_id_for_connector_{connectorId}' to null
        const updateFields = {
            [connectorTagIdField]: null,
            [connectorTagIdInUseField]: false
        };

        // Update the specific connector's 'tag_id' field to null
        const updateResult = await chargerDetailsCollection.updateOne(
            { charger_id: charger_id, [connectorTagIdField]: idTag },
            { $set: updateFields }
        );

        if (updateResult.matchedCount === 0) {
            console.log(`Charger ID ${charger_id} with Tag ID ${idTag} not found`);
        } else if (updateResult.modifiedCount === 0) {
            console.log(`Charger ID ${charger_id} with Tag ID ${idTag} found but no changes were made.`);
        } else {
            console.log(`Charger ID ${charger_id} successfully updated '${connectorTagIdField}' to null`);
        }
    } catch (error) {
        console.error('UpdateInUse error:', error);
    }
};

const NullTagIDInStatus = async (charger_id, connector_id) =>{
    try{
        const db = await database.connectToDatabase();
        const chargerDetailsCollection = db.collection('charger_details');

        // Construct the dynamic field name for the specific connector
        const connectorTagIdField = `tag_id_for_connector_${connector_id}`;
        const connectorTagIdInUseField = `tag_id_for_connector_${connector_id}_in_use`;

        // Create the update field to set 'tag_id_for_connector_{connectorId}' to null
        const updateFields = {
            [connectorTagIdField]: null,
            [connectorTagIdInUseField]: false
        };

        // Update the specific connector's 'tag_id' field to null
        const updateResult = await chargerDetailsCollection.updateOne(
            { charger_id: charger_id },
            { $set: updateFields }
        );

        if (updateResult.matchedCount === 0) {
            console.log(`Charger ID ${charger_id} not found`);
        } else if (updateResult.modifiedCount === 0) {
            console.log(`Charger ID ${charger_id} found but no changes were made.`);
        } else {
            console.log(`Charger ID ${charger_id} successfully updated '${connectorTagIdField}' details updated`);
        }

    }catch(error){
        console.error('NullTagIDInStatus error:', error);
    }
}




// async function checkAuthorization(charger_id, idTag) {
//     try {
//         const db = await connectToDatabase();
//         const chargerDetailsCollection = db.collection('charger_details');
//         const tagIdCollection = db.collection('tag_id'); // Assuming the collection name is 'tag_id'

//         // If connector_id is null, directly check the tag_id in the tag_id collection
//         if (connector_id === null) {
//             const tagIdDetails = await tagIdCollection.findOne({ tag_id: idTag });
//             if (!tagIdDetails) {
//                 return { status: "Invalid" };
//             }

//             const expiryDate = new Date(tagIdDetails.tag_id_expiry_date);
//             const currentDate = new Date();

//             if (tagIdDetails.status === false) {
//                 return { status: "Blocked", expiryDate: expiryDate.toISOString() };
//             } else if (expiryDate < currentDate) {
//                 return { status: "Expired", expiryDate: expiryDate.toISOString() };
//             } else if (tagIdDetails.in_use === true) {
//                 return { status: "ConcurrentTx", expiryDate: expiryDate.toISOString() };
//             } else {
//                 return { status: "Accepted", expiryDate: expiryDate.toISOString() };
//             }
//         }

//         // Generate the field name dynamically based on the connector ID
//         const connectorTagIdField = `tag_id_for_connector_${connector_id}`;
//         console.log("connectorTagIdField", connectorTagIdField);
        
//         // Fetch charger details
//         const chargerDetails = await chargerDetailsCollection.findOne(
//             { charger_id },
//             { projection: { [connectorTagIdField]: 1 } }
//         );
//         console.log("chargerDetails", chargerDetails);

//         if (!chargerDetails || chargerDetails[connectorTagIdField] !== idTag) {
//             return { status: "Invalid" };
//         }

//         // Fetch tag_id details from the separate collection
//         const tagIdDetails = await tagIdCollection.findOne({ tag_id: idTag });

//         if (!tagIdDetails) {
//             return { status: "Invalid" };
//         }

//         const expiryDate = new Date(tagIdDetails.tag_id_expiry_date);
//         const currentDate = new Date();

//         // Check various conditions based on the tag_id details
//         if (tagIdDetails.status === false) {
//             return { status: "Blocked", expiryDate: expiryDate.toISOString() };
//         } else if (expiryDate < currentDate) {
//             return { status: "Expired", expiryDate: expiryDate.toISOString() };
//         } else if (tagIdDetails.in_use === true) {
//             return { status: "ConcurrentTx", expiryDate: expiryDate.toISOString() };
//         } else {
//             return { status: "Accepted", expiryDate: expiryDate.toISOString() };
//         }

//     } catch (error) {
//         console.error(`Error checking tag_id for charger_id ${charger_id} and connector_id ${connector_id}:`, error);
//         return { status: "Error" };
//     }
// }



async function checkAuthorization(charger_id, idTag) {
    try {
        const db = await connectToDatabase();
        const chargerDetailsCollection = db.collection('charger_details');
        const tagIdCollection = db.collection('tag_id');

        // Fetch charger details, including the chargePointModel
        const chargerDetails = await chargerDetailsCollection.findOne(
            { charger_id },
            { projection: { model: 1 } }
        );
        if (!chargerDetails || !chargerDetails.model) {
            return { status: "Invalid" };
        }

        // Dynamically determine the number of connectors based on the chargePointModel
        const connectors = chargerDetails.model.split('- ')[1];
        const totalConnectors = Math.ceil(connectors.length / 2);

        // Dynamically create the projection fields based on the number of connectors
        let projection = { charger_id: 1 };
        for (let i = 1; i <= totalConnectors; i++) {
            projection[`current_or_active_user_for_connector_${i}`] = 1;
            projection[`tag_id_for_connector_${i}`] = 1;
            // projection[`tag_id_for_connector_${i}_in_use`] = 1;
        }
        
        // Fetch charger details with dynamically generated projection
        const chargerDetailsWithConnectors = await chargerDetailsCollection.findOne(
            { charger_id },
            { projection }
        );
        if (!chargerDetailsWithConnectors) {
            return { status: "Invalid" };
        }

        // Identify the connector associated with the provided tag_id
        let connectorId = null;
        for (let i = 1; i <= totalConnectors; i++) {
            if (chargerDetailsWithConnectors[`tag_id_for_connector_${i}`] === idTag) {
                connectorId = i;
                break;
            }
        }

        if (!connectorId) {
            connectorId = 1;
        }

        // Check if the tag_id_for_connector_{id} does not match the provided idTag
        for (let i = 1; i <= totalConnectors; i++) {
            if (i !== connectorId && chargerDetailsWithConnectors[`tag_id_for_connector_${i}`] === idTag) {
                return { status: "ConcurrentTx", connectorId };
            }
        }

        // Fetch tag_id details from the separate collection
        let tagIdDetails = await tagIdCollection.findOne({ tag_id: idTag });

        let expiryDate;
        let currentDate = new Date();

        if(!tagIdDetails){
            expiryDate = new Date();
            expiryDate.setDate(currentDate.getDate() + 1); // Add one day to the expiry date
            tagIdDetails = { status: true};
        }else if(tagIdDetails){
            expiryDate = new Date(tagIdDetails.tag_id_expiry_date);
        }

        // Check various conditions based on the tag_id details
        if (tagIdDetails.status === false) {
            return { status: "Blocked", expiryDate: expiryDate.toISOString() , connectorId};
        } else if (expiryDate <= currentDate) {
            return { status: "Expired", expiryDate: expiryDate.toISOString() , connectorId};
        } else {
            return { status: "Accepted", expiryDate: expiryDate.toISOString() , connectorId};
        }

    } catch (error) {
        console.error(`Error checking tag_id for charger_id ${charger_id}:`, error);
        return { status: "Error" };
    }
}

// Function to calculate the difference between two sets of MeterValues
async function calculateDifference(startValues, lastValues,uniqueIdentifier) {
    const startEnergy = startValues || 0;
    const lastEnergy = lastValues || 0;
    console.log(startEnergy, lastEnergy);
    const differ = lastEnergy - startEnergy;
    // let calculatedUnit = parseFloat(differ / 1000).toFixed(3);
    let calculatedUnit = differ;
    let unit;
    if (calculatedUnit === null || isNaN(parseFloat(calculatedUnit))) {
        unit = 0;
    } else {
        unit = calculatedUnit;
    }
    const sessionPrice = await calculatePrice(unit, uniqueIdentifier);
    const formattedSessionPrice = isNaN(sessionPrice) || sessionPrice === 'NaN' ? 0 : parseFloat(sessionPrice).toFixed(2);
    console.log(formattedSessionPrice);

    // Update commission to wallet
    const commissionUpdateResult = await UpdateCommissionToWallet(formattedSessionPrice, uniqueIdentifier);
    if(commissionUpdateResult){
        console.log('Commission updated to wallet successfully');
    }else{
        console.log('Commission failed to update');
    }


    return { unit, sessionPrice: formattedSessionPrice };
}

// Fetch the correct user active based on the connector ID
async function getUsername(chargerID, connectorId, TagID) {
    try {
        const db = await connectToDatabase();
        const evDetailsCollection = db.collection('charger_details');
        const chargerDetails = await evDetailsCollection.findOne({ charger_id: chargerID });
        if (!chargerDetails) {
            console.log('getUsername - Charger ID not found in the database');
            return null;
        }
        
        const userField = `current_or_active_user_for_connector_${connectorId}`;
        let username = chargerDetails[userField];

        // while start the charger using nfc card, here get the username using tag id and update the respective fields
        if(TagID){
            if(username === null){
                const userCollection = db.collection('users');
                const tagIdCollection = db.collection('tag_id');
                const GetTagID = await tagIdCollection.findOne({ tag_id: TagID });

                if(!GetTagID){
                    console.log(`Tag ID not found in the database !`);
                } else {
                    const GetUsername = await userCollection.findOne({ tag_id: GetTagID.id });
                    const updateUsername = await evDetailsCollection.updateOne(
                    { charger_id: chargerID },
                    {
                        $set: {
                        [userField]: GetUsername.username
                        }
                    }
                    );

                    // Check if the update was successful
                    if (updateUsername.matchedCount === 0) {
                        console.log('getUsername - UserName Not updated using NFC card');
                    } else if (updateUsername.modifiedCount === 0) {
                        username = GetUsername.username;
                        console.log('getUsername - UserName Not updated using NFC card, same value(username) in the table');
                    } else {
                        username = GetUsername.username;
                        console.log('getUsername - UserName updated successfully');
                    } 
                }     
            }
        }else{
            console.log(`TagID is null - If its remote start/stop it will be fine !`);
        }

        return username || null; // Return the username or null if not found
    } catch (error) {
        console.error('Error getting username:', error);
        return null;
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

        // console.log(`getAutostop_time: ${time_val} & ${isTimeChecked}, getAutostop_unit: ${unit_val} & ${isUnitChecked}, getAutostop_price: ${price_val} & ${isPriceChecked}`);

        return { 'time_value': time_val, 'isTimeChecked': isTimeChecked, 'unit_value': unit_val, 'isUnitChecked': isUnitChecked, 'price_value': price_val, 'isPriceChecked': isPriceChecked };

    }catch(error){
        console.error(error);
        return false;
    }
}


async function captureMetervalues(Identifier, requestData, uniqueIdentifier, clientIpAddress, UniqueChargingsessionId, connectorId) {
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
    keyValuePair.charger_id = uniqueIdentifier;
    keyValuePair.Timestamp = currentTime;
    keyValuePair.clientIP = clientIpAddress;
    keyValuePair.SessionID = UniqueChargingsessionId;
    keyValuePair.connectorId = connectorId;

    const ChargerValue = JSON.stringify(keyValuePair);
    await SaveChargerValue(ChargerValue);
    await updateTime(uniqueIdentifier, connectorId);
    if (keyValuePair['Energy.Active.Import.Register'] !== undefined) {
        return EnergyValue;
    }
    return undefined;
}


async function autostop_unit(firstMeterValues,lastMeterValues,autostopSettings,uniqueIdentifier, connectorId){

    const startEnergy = firstMeterValues || 0;
    const lastEnergy = lastMeterValues || 0;
    
    const result = lastEnergy - startEnergy;
    let calculatedUnit = parseFloat(result / 1000).toFixed(3);

    console.dir(autostopSettings);
    // console.log(`${autostopSettings.unit_value},${calculatedUnit}`);

    if (autostopSettings.unit_value && autostopSettings.isUnitChecked === true) {
        if(autostopSettings.unit_value <= calculatedUnit){
            console.log(`Charger ${uniqueIdentifier} stop initiated - auto stop unit`);
            const result = await Chargercontrollers.chargerStopCall(uniqueIdentifier, connectorId );
            if (result === true) {
                console.log(`AutoStop unit: Charger Stopped !`);
            } else {
                console.log(`Error: ${result}`);
            }
        }
    }

}

async function calculatePrice(unit, uniqueIdentifier) {
    const db = await connectToDatabase();
    const chargerDetailsCollection = db.collection('charger_details');
    const financeDetailsCollection = db.collection('finance_details');

    // Fetch the unit price and finance details from the charger_details table
    const chargerDetails = await chargerDetailsCollection.findOne({ charger_id: uniqueIdentifier });

    if (chargerDetails && chargerDetails.finance_id !== null) {
        const finance_id = chargerDetails.finance_id;
        const financeDetails = await financeDetailsCollection.findOne({ finance_id: finance_id });
        
        if (!financeDetails) {
            throw new Error(`Finance details for finance_id ${finance_id} not found.`);
        }

        const pricePerUnit = financeDetails.eb_charges; // Fetch the unit price from the database

        // Calculate the total percentage of the various charges
        const totalPercentage = [
            financeDetails.app_charges,
            financeDetails.other_charges,
            financeDetails.parking_charges,
            financeDetails.rent_charges,
            financeDetails.open_a_eb_charges,
            financeDetails.open_other_charges
        ].reduce((sum, charge) => sum + parseFloat(charge), 0);

        // Calculate the final price
        const price = unit * pricePerUnit;
        const finalPrice = price + (price * totalPercentage / 100);
        return finalPrice;
    } else {
        throw new Error(`Charger with ID ${uniqueIdentifier} not found or finance details not defined.`);
    }
}

async function UpdateCommissionToWallet(sessionPrice, uniqueIdentifier) {
    const db = await connectToDatabase();
    const chargerDetailsCollection = db.collection('charger_details');
    const ResellerDetailsCollection = db.collection('reseller_details');
    const ClientDetailsCollection = db.collection('client_details');
    const AssociationDetailsCollection = db.collection('association_details');

    // Fetch charger details
    const chargerDetails = await chargerDetailsCollection.findOne({ charger_id: uniqueIdentifier });

    if (!chargerDetails) {
        throw new Error(`Charger with ID ${uniqueIdentifier} not found.`);
    }

    // Extract commission percentages
    const resellerCommissionPercentage = parseFloat(chargerDetails.reseller_commission);
    const clientCommissionPercentage = parseFloat(chargerDetails.client_commission);

    // Calculate commissions
    const resellerCommission = (sessionPrice * resellerCommissionPercentage) / 100;
    const clientCommission = (sessionPrice * clientCommissionPercentage) / 100;

    let resellerCommissionUpdate;
    let clientCommissionUpdate;
    let clientPriceUpdate;

    // Update reseller wallet
    if (chargerDetails.assigned_reseller_id) {
        const reseller_id = chargerDetails.assigned_reseller_id;
        resellerCommissionUpdate = await updateWallet(ResellerDetailsCollection, reseller_id, resellerCommission, 'reseller');
    }

    // Update client wallet
    if (chargerDetails.assigned_client_id) {
        const client_id = chargerDetails.assigned_client_id;
        clientCommissionUpdate = await updateWallet(ClientDetailsCollection, client_id, clientCommission, 'client');
    }

    // Update association wallet with total commission (reseller + client)
    if (chargerDetails.assigned_association_id) {
        const association_id = chargerDetails.assigned_association_id;
        const totalCommission = resellerCommission + clientCommission;
        const AssociationPrice = sessionPrice - totalCommission;
        clientPriceUpdate = await updateWallet(AssociationDetailsCollection, association_id, AssociationPrice, 'association');
    }

    if(resellerCommissionUpdate && clientCommissionUpdate && clientPriceUpdate){
        console.log(`All commissions updated successfully !`);
        return true;
    }else{
        console.log(`All commissions failed to update !`);
        return false;
    }
}

async function updateWallet(collection, id, amount, type) {
    const walletField = `${type}_wallet`;
    const numericAmount = parseFloat(amount.toFixed(2));

    const updateResult = await collection.updateOne(
        { [`${type}_id`]: id },
        { $inc: { [walletField]: numericAmount } }
    );

    if (updateResult.modifiedCount > 0) {
        console.log(`${type} wallet updated successfully for ID: ${id}. Amount: ${numericAmount}`);
        return true;
    } else {
        console.log(`Failed to update ${type} wallet for ID: ${id}`);
        return false;
    }
}



async function autostop_price(firstMeterValues, lastMeterValues, autostopSettings, uniqueIdentifier, connectorId) {
    const startEnergy = firstMeterValues || 0;
    const lastEnergy = lastMeterValues || 0;

    // Calculate the energy consumed in kWh
    const result = lastEnergy - startEnergy;
    const calculatedUnit = parseFloat(result / 1000).toFixed(3);
    const unit = isNaN(calculatedUnit) ? 0 : calculatedUnit;


    // Calculate the session price
    try {
        const sessionPrice = await calculatePrice(unit, uniqueIdentifier);
        const formattedSessionPrice = isNaN(sessionPrice) || sessionPrice === 'NaN' ? 0 : parseFloat(sessionPrice).toFixed(2);
        console.log(`formattedPrice:`, formattedSessionPrice);

        // Update commission to wallet
        const commissionUpdateResult = await UpdateCommissionToWallet(formattedSessionPrice, uniqueIdentifier);
        if(commissionUpdateResult){
            console.log('Commission updated to wallet successfully');
        }else{
            console.log('Commission failed to update');
        }

        // Check if the auto stop conditions are met
        if (autostopSettings.price_value && autostopSettings.isPriceChecked === true) {
            if (autostopSettings.price_value <= formattedSessionPrice) {
                console.log(`Charger ${uniqueIdentifier} stop initiated - auto stop price`);
                const result = await chargerStopCall(uniqueIdentifier, connectorId);
                if (result === true) {
                    console.log(`AutoStop price: Charger Stopped!`);
                } else {
                    console.log(`Error: ${result}`);
                }
            }
        }
    } catch (error) {
        console.log('Failed to calculate session price:', error);
    }
}


const insertSocketGunConfig = async (uniqueIdentifier, chargePointModel) => {
    const connectors = chargePointModel.split('- ')[1];
    const connectorTypes = {};
    let currentConnectorIndex = 1; // Use a single index to correctly track connector numbers

    // Parse the connector types correctly
    for (let i = 0; i < connectors.length; i += 2) {
        const type = connectors[i + 1];

        if (type === 'S') {
            connectorTypes[`connector_${currentConnectorIndex}_type`] = 1; // 1 for Socket

        } else if (type === 'G') {
            connectorTypes[`connector_${currentConnectorIndex}_type`] = 2; // 2 for Gun

        }

        currentConnectorIndex++; // Increment the connector index after each iteration
    }

    console.log("Final ConnectorTypes:", connectorTypes);

    const socketGunConfig = {
        charger_id: uniqueIdentifier,
        ...connectorTypes,
        created_date: new Date(),
        modified_date: null
    };

    const db = await connectToDatabase();
    const existingConfig = await db.collection('socket_gun_config').findOne({ charger_id: uniqueIdentifier });

    if (existingConfig) {
        await db.collection('socket_gun_config').updateOne(
            { charger_id: uniqueIdentifier },
            {
                $set: {
                    ...connectorTypes,
                    modified_date: new Date()
                }
            }
        );
        console.log(`ChargerID: ${uniqueIdentifier} - Socket/Gun configuration updated successfully.`);
    } else {
        await db.collection('socket_gun_config').insertOne(socketGunConfig);
        console.log(`ChargerID: ${uniqueIdentifier} - Socket/Gun configuration inserted successfully.`);
    }

    const chargerDetails = {
        charger_id: uniqueIdentifier,
        created_date: new Date(),
    };

    // Dynamically create the projection fields based on connector IDs
    const totalConnectors = Object.keys(connectorTypes).length; // Get total number of connectors based on the parsed connector types
    let projection = { charger_id: 1 };
    for (let i = 1; i <= totalConnectors; i++) {
        projection[`current_or_active_user_for_connector_${i}`] = 1;
        projection[`tag_id_for_connector_${i}`] = 1;
        projection[`transaction_id_for_connector_${i}`] = 1;
        projection[`transaction_id_for_connector_${i}_in_use`] = 1;

    }

    
    const existingChargerDetails = await db.collection('charger_details').findOne(
        { charger_id: uniqueIdentifier },
        { projection }
    );


    if (!existingChargerDetails) {
        // If no existing charger details, insert new details
        for (let i = 1; i <= totalConnectors; i++) {
            chargerDetails[`tag_id_for_connector_${i}`] = null; 
            chargerDetails[`tag_id_for_connector_${i}_in_use`] = null;
            chargerDetails[`transaction_id_for_connector_${i}`] = null;
            chargerDetails[`current_or_active_user_for_connector_${i}`] = null;
        }

        const result = await db.collection('charger_details').insertOne(chargerDetails);
        if (result.insertedId) {
            console.log(`ChargerID: ${uniqueIdentifier} - Charger details inserted successfully.`);
        } else {
            console.log(`ChargerID: ${uniqueIdentifier} - Charger details insertion failed.`);
        }
    } else {
        // Initialize missing fields in existingChargerDetails
        const updateFields = {};
        for (let i = 1; i <= totalConnectors; i++) {
            if (!existingChargerDetails.hasOwnProperty(`tag_id_for_connector_${i}`) || existingChargerDetails[`tag_id_for_connector_${i}`] === null) {
                updateFields[`tag_id_for_connector_${i}`] = null;
            }

            if (!existingChargerDetails.hasOwnProperty(`tag_id_for_connector_${i}_in_use`) || existingChargerDetails[`tag_id_for_connector_${i}_in_use`] === null) {
                updateFields[`tag_id_for_connector_${i}_in_use`] = null;
            }

            if (!existingChargerDetails.hasOwnProperty(`transaction_id_for_connector_${i}`) || existingChargerDetails[`transaction_id_for_connector_${i}`] === null) {
                updateFields[`transaction_id_for_connector_${i}`] = null;
            }

            if (!existingChargerDetails.hasOwnProperty(`current_or_active_user_for_connector_${i}`) || existingChargerDetails[`current_or_active_user_for_connector_${i}`] === null) {
                updateFields[`current_or_active_user_for_connector_${i}`] = null;
            }
        }

        if (Object.keys(updateFields).length > 0) {
            const result = await db.collection('charger_details').updateOne(
                { charger_id: uniqueIdentifier },
                { $set: updateFields }
            );
            if (result.modifiedCount > 0) {
                console.log(`ChargerID: ${uniqueIdentifier} - Charger details updated successfully.`);
            } else {
                console.log(`ChargerID: ${uniqueIdentifier} - Charger details update failed.`);
            }
        } else {
            console.log(`ChargerID: ${uniqueIdentifier} - No fields to update.`);
        }
    }
};





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
                    insertSocketGunConfig,
                    NullTagIDInStatus
                };