const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const xRay = AWSXRay.captureAWS(require("aws-sdk"))

const eventsDdb = process.env.EVENTS_DDB
const invoiceWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT.substring(6)

const awsRegion = process.env.AWS_REGION

AWS.config.update({
    region: awsRegion
})

const ddbClient = new AWS.DynamoDB.DocumentClient()
const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: invoiceWsApiEndpoint
})

exports.handler = async function(event, context){

    console.log(event)

    const promises = []
    for(let index = 0; index < event.Records.length; index++){
        const record = event.Records[index]

        console.log(record)

        if(record.eventName === 'INSERT'){
            // invoivce de transação 
            if(record.dynamodb.NewImage.pk.S == '#transaction'){
                console.log('invoice transaction received')
            }else{
                console.log('Invoice received')
                promises.push(createEvent(record.dynamodb.NewImage, "INVOICE_CREATED"))
            }
        }else if(record.eventName === 'MODIFY'){
            console.log('Event: MODIFY')
        }else if(record.eventName === 'REMOVE'){
            // transaction timeout 
            if(record.dynamodb.OldImage.pk.S == '#transaction'){
                console.log('Invoice transaction timeout received')
                const transactionId = record.dynamodb.OldImage.sk.S
                const connectionId = record.dynamodb.OldImage.connectionId.S

                if(record.dynamodb.OldImage.transactionStatus.S === 'INVOICE_PROCESSED'){
                    console.log('invoice processed')
                }else{
                    console.log('Invoice import failed - timeout / error')
                    await sendInvoiceStatus(transactionId, connectionId, 'TIMEOUT')
                }
                
                promises.push(disconnectClient(connectionId))
            }
        }
    }

    await Promise.all(promises)

    return {}
}

async function disconnectClient(connectionId){
    try{
        const params = {
            ConnectionId: connectionId
        }
    
        await apigwManagementApi.getConnection(params).promise()
        return apigwManagementApi.deleteConnection(params).promise()
    }catch(err){
        console.log(err)
    }
}

async function sendInvoiceStatus(transactionId, connectionId, status){
    try{
        const postData = JSON.stringify({
            key: transactionId, 
            status
        })
    
        await apigwManagementApi.getConnection(params).promise()
        return apigwManagementApi.postToConnection({
            ConnectionId: connectionId, 
            data: postData
        }).promise()
    }catch(err){
        console.log(err)
    }
}

function createEvent(invoiceEvent, eventType){
    const timestamp = Data.now()
    const ttl = ~~(timestamp / 1000 + 60 * 60)

    console.log('create event ddb')

    const params = {
        TableName: eventsDdb, 
        Item: {
            pk: `#invoice_${invoiceEvent.sk.S}`,
            sk: `${eventType}#${timestamp}`,
            ttl: ttl, 
            email: invoiceEvent.pk.S.split('_')[1], 
            eventType: eventType,
            info: {
                transactionId: invoiceEvent.transactionId.S,
                productId: invoiceEvent.productId.S
            }
        }
    }
    
    console.log('create event ddb 2 ')

    return ddbClient.put(params).promise()
}