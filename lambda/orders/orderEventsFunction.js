const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const xRay = AWSXRay.captureAWS(require("aws-sdk"))

const eventsDdb = process.env.EVENTS_DDB

const awsRegion = process.env.AWS_REGION

AWS.config.update({
    region: awsRegion
})

const ddbClient = new AWS.DynamoDB.DocumentClient()

exports.handler = async function(event, context){
    const promises = []

    console.log(event.Records[0])

    event.Records.forEach(record => {
        promises.push(createEvent(record.Sns))
    });
    
    await Promise.all(promises)

    return {}
}

function createEvent(body){
    const envelope = JSON.parse(body.Message)
    const event = JSON.parse(envelope.data)

    console.log(`Creating order event = MessageId = ${body.MessageId}`)

    const timestamp = Date.now() 
    const ttl = ~~(timestamp / 1000 + 120 * 60) //5 minutos depois 

    const params = {
        TableName: eventsDdb, 
        Item: {
            pk: `#order_${event.sk}`, 
            sk: `${envelope.eventType}#${timestamp}`,
            ttl: ttl,
            email: event.email, 
            createdAt: timestamp,
            requestId: event.requestId,
            eventType: envelope.eventType,
            info: {
                orderId: event.orderId, 
                productCodes: event.productCodes,
                messageId: body.MessageId
            }
        }
    }

    return ddbClient.put(params).promise()
}