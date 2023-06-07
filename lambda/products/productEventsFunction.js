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
    
    await createEvent(event.productEvent)

    context.succeed(
        JSON.stringify({
            productEventCreated: true, 
            message: "OK"
        })
    )

}

function createEvent(productEvent){
    /*
    {
        "requestId": "a514cce8-c49b-4f7d-",
        "eventType": "PRODUCT_CREATED",
        "productId": "63aa2a0c-6647-41cd-",
        "productCode": "COD4",
        "productPrice": 40.5,
        "email": "matilde@siecola.com.br"
    }
    */

    const timestamp = Date.now() 
    const ttl = ~~(timestamp / 1000 + 120 * 60) //5 minutos depois 

    const params = {
        TableName: eventsDdb, 
        Item: {
            pk: `#products_${productEvent.productCode}`, 
            sk: `${productEvent.eventType}#${timestamp}`,
            ttl: ttl,
            email: productEvent.email, 
            createdAt: timestamp,
            requestId: productEvent.requestId,
            eventType: productEvent.eventType,
            info: {
                productId: productEvent.productId, 
                price: productEvent.productPrice
            }
        }
    }

    return ddbClient.put(params).promise()

}