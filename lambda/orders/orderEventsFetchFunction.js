const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const xRay = AWSXRay.captureAWS(require("aws-sdk"))

const awsRegion = process.env.AWS_REGION
const eventsDdb = process.env.EVENTS_DDB

AWS.config.update({
    region: awsRegion
})

const ddbClient = new AWS.DynamoDB.DocumentClient()

exports.handler = async function(event, context){
    const method = event.httpMethod;
    const apiRequestId = event.requestContext.requestId;
    const lambdaRequestId = context.awsRequestId; 

    const email = event.queryStringParameters.email 
    const eventType = event.queryStringParameters.eventType

    if(method === 'GET'){
        if(email & eventType){
            const data = await getOrderEventsByEmailAndEventType(email, eventType)

            return {
                statusCode: 200, 
                body: JSON.stringify(convertOrderEvents(data.Items))
            }
        }else if(email){
            const data = await getOrderEventsByEmail(email)

            return {
                statusCode: 200, 
                body: JSON.stringify(convertOrderEvents(data.Items))
            }
        }
    }

    return {
        statusCode: 400, 
        body: JSON.stringify('Bad request')
    }
}

function getOrderEventsByEmailAndEventType(email, eventType){
    const params = {
        TableName: eventsDdb, 
        IndexName: 'emailIdx', 
        KeyConditionExpression: 'email = :email AND begins_with(sk, :prefix)', 
        ExpressionAttributeValues: {
            ':email': email, 
            ':prefix': eventType 
        }
    }

    return ddbClient.query(params).promise()
}

function getOrderEventsByEmail(email){
    const params = {
        TableName: eventsDdb, 
        IndexName: 'emailIdx', 
        KeyConditionExpression: 'email = :email AND begins_with(sk, :prefix)', 
        ExpressionAttributeValues: {
            ':email': email, 
            ':prefix': 'ORDER_'
        }
    }

    return ddbClient.query(params).promise()
}

function convertOrderEvents(items){
    return items.map((item)=> {
        return {
            email: item.email,
            createdAt: item.createdAt,
            eventType: item.eventType,
            request: item.requestId, 
            orderId: item.info.orderId,
            productCodes: item.info.productCodes
        }
    })
}