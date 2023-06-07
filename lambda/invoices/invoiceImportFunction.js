const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const { disconnect } = require("cluster")

const xRay = AWSXRay.captureAWS(require("aws-sdk"))

const awsRegion = process.env.AWS_REGION
const invoiceDdb = process.env.INVOICES_DDB
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
    
    console.log(event.Records[0].s3)

    const key = event.Records[0].s3.object.key
    
    const params = {
        Key: key, 
        Bucket: event.Records[0].s3.bucket.name
    }

    const invoiceTransactionResult = await getInvoiceTransaction(key)
    const invoiceTransaction = invoiceTransactionResult.Item
    
    if(invoiceTransaction){
        if(invoiceTransaction.transactionStatus === 'URL_GENERATED'){
            await Promise.all([
                sendInvoiceStatus(invoiceTransaction.sk, invoiceTransaction.connectionId,"INVOICE_RECEIVED"), 
                updateInvoiceTransaction(key, "INVOICE_RECEIVED")
            ])
        }else{ 
            sendInvoiceStatus(invoiceTransaction.sk, invoiceTransaction.connectionId,invoiceTransaction.transactionStatus)
            console.log(`Non valid transaction status: ${invoiceTransaction.transactionStatus}`)
            return {}
        }
    }

    const object = await s3Client.getObject(params).promise()
    const invoice = JSON.parse(object.Body.toString('utf-8'))

    if(!invoice.invoiceNumber){
        console.error("No invoice number")
        
        await sendInvoiceStatus(invoiceTransaction.sk, invoiceTransaction.connectionId, "ERROR: NO INVOICE NUMBER IN FILE")
            
        await disconnectClient(invoiceTransaction.connectionId)
    }else{
        const createInvoicePromise = createInvoice(invoice, key)
        const deleteInvoicePromise = s3Client.deleteObject(params).promise()

        if(invoiceTransaction){
            await Promise.all([
                sendInvoiceStatus(invoiceTransaction.sk, invoiceTransaction.connectionId,"INVOICE_PROCESSED"), 
                updateInvoiceTransaction(key, "INVOICE_PROCESSED")
            ])
        }

        await Promise.all([createInvoicePromise, deleteInvoicePromise])
        await disconnectClient(invoiceTransaction.connectionId)
    }


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

function getInvoiceTransaction(key){
    const params = {
        TableName: invoiceDdb,
        Key: {
            pk: "#transaction",
            sk: key
        }
    }

    return ddbClient.get(params).promise()
}

function sendInvoiceStatus(transactionId, connectionId, transactionStatus){
    const postData = JSON.stringify({
        key: transactionId, 
        status: transactionStatus
    })

    return apigwManagementApi.postToConnection({
        ConnectionId: connectionId,
        Data: postData
    }).promise()
}

function createInvoice(invoice, transactionId){
    const params = {
        TableName: invoiceDdb, 
        Item: {
            pk: `#invoice_${invoice.customerName}`,
            sk: invoice.invoiceNumber,
            totalValue: invoice.totalValue, 
            productId: invoice.productId,
            quantity: invoice.quantity,
            transactionId: transactionId,
            ttl: 0,
            createdAt: Date.now()
        }
    }

    return ddbClient.put(params).promise()
}

function updateInvoiceTransaction(key, transactionStatus){
    const params = {
        TableName: invoiceDdb, 
        Key: {
            pk: "#transaction",
            sk: key
        },
        UpdateExpression: 'set transactionStatus = :s',
        ExpressionAttributeValues: {
            ':s': transactionStatus
        }
    }

    return ddbClient.update(params).promise()
}
