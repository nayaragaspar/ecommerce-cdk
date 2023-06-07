const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const uuid = require("uuid")

const xRay = AWSXRay.captureAWS(require("aws-sdk"))

const awsRegion = process.env.AWS_REGION
const invoiceDdb = process.env.INVOICES_DDB
const bucketName = process.env.BUCKET_NAME
const invoiceWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT.substring(6)

AWS.config.update({
    region: awsRegion
})

const ddbClient = new AWS.DynamoDB.DocumentClient()
const s3Client = new AWS.S3({
    region: awsRegion
})

const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: invoiceWsApiEndpoint
})

exports.handler = async function(event, context){
    
    console.log(event)
    
    const connectionId = event.requestContext.connectionId;
    const lambdaRequestId = context.awsRequestId; 

    //console.log(`ConnectionId: ${connectionId} - LambdaId: ${lambdaRequestId}`)

    //console.log(invoiceWsApiEndpoint)

    const expires = 300
    const key = uuid.v4()
    const params = {
        Bucket: bucketName, 
        Key: key, 
        Expires: expires
    }

    const signedUrl = await s3Client.getSignedUrl('putObject', params)
    console.log(signedUrl)

    const postData = JSON.stringify({
        url: signedUrl,
        expires: expires,
        transactionId: key
    })

    await createInvoiceTransaction(key, lambdaRequestId, expires, connectionId, invoiceWsApiEndpoint)

    await apigwManagementApi.postToConnection({
        ConnectionId: connectionId, 
        Data: postData
    }).promise()

    return {}
}

function createInvoiceTransaction(key, lambdaRequestId, expires, connectionId, invoiceWsApiEndpoint){
    const timestamp = Date.now()
    const ttl = ~~(timestamp / 1000 + 2 * 60)
    
    const params = {
        TableName: invoiceDdb, 
        Item: {
            pk: '#transaction',
            sk: key,
            ttl: ttl, 
            requestId: lambdaRequestId, 
            transactionStatus: 'URL_GENERATED', 
            timestamp: timestamp, 
            expires: expires, 
            connectionId: connectionId, 
            endpoint: invoiceWsApiEndpoint
        }
    }

    return ddbClient.put(params).promise()
}