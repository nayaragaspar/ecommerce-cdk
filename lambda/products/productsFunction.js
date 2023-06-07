const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const uuid = require("uuid")

const xRay = AWSXRay.captureAWS(require("aws-sdk"))

const productsDdb = process.env.PRODUCTS_DDB
const awsRegion = process.env.AWS_REGION
const productEventsFunctionName = process.env.PRODUCT_EVENTS_FUNCTION_NAME

AWS.config.update({
    region: awsRegion
})

const ddbClient = new AWS.DynamoDB.DocumentClient()
const lambdaClient = new AWS.Lambda()

exports.handler = async function(event, context){
    const method = event.httpMethod;

    const apiRequestId = event.requestContext.requestId;
    const lambdaRequestId = context.awsRequestId; 

    console.log(`APi Gateway id: ${apiRequestId} - Lambda Id: ${lambdaRequestId}`);

    if(event.resource === '/products'){
        if(method === 'GET'){
            // GET /products
            const data = await getAllProducts()

            return{
                statusCode: 200,
                body: JSON.stringify(data.Items)
            }
        }else if(method === 'POST'){
            // POST /products
            const product = JSON.parse(event.body)
            product.id = uuid.v4()

            await createProduct(product)

            await sendProductEvent(product, "PRODUCT_CREATED", "teste@gmail.com", lambdaRequestId)

            return {
                statusCode: 201, 
                body: JSON.stringify(product)
            }
        }
    }else if(event.resource === '/products/{id}'){
        const productId = event.pathParameters.id

        // GET /products/{id}
        if(method === 'GET'){
            const data = await getProductsById(productId)

            if(data.Item){
                return {
                    statusCode: 200, 
                    body: JSON.stringify(data.Item)
                }
            }else{
                return {
                    statusCode: 404, 
                    body: JSON.stringify(`Product with ID ${productId} not found`)
                }
            }

        }else if(method === 'PUT'){
            // PUT /products/{id}
            const data = await getProductsById(productId)
            if(data.Item){
                const product = JSON.parse(event.body)
                const putPromise =   updateProduct(productId, product)

                const sendEventPromise =   sendProductEvent(product, "PRODUCT_UPDATED", "teste222@gmail.com", lambdaRequestId)

                const result = Promise.all([putPromise, sendEventPromise])
                console.log(result[1])
                
                return {
                    statusCode: 200, 
                    body: JSON.stringify(product)
                }
            }else{
                return {
                    statusCode: 404, 
                    body: JSON.stringify(`Product with ID ${productId} not found`)
                }
            }
        }else if(method === 'DELETE'){
            // DELETE /products/{id}
            const data = await getProductsById(productId)
            if(data.Item){
                const product = JSON.parse(event.body)
                const deletePromise =  deleteProduct(productId)

                const sendEventPromise = sendProductEvent(data.Item, "PRODUCT_DELETED", "testedelete@gmail.com", lambdaRequestId)

                const result = Promise.all([deletePromise, sendEventPromise])
                
                console.log(result[1])

                return {
                    statusCode: 200, 
                    body: JSON.stringify(data.Item)
                }
            }else{
                return {
                    statusCode: 404, 
                    body: JSON.stringify(`Product with ID ${productId} not found`)
                }
            }
        }

    }

    return {
        statusCode: 400, 
        body: JSON.stringify({
            message: "Bad request", 
            lambdaRequestId
        })
    }
}

function sendProductEvent(product, event, email, lambdaRequestId){
    const params = {
        FunctionName: productEventsFunctionName, 
        InvocationType: "RequestResponse", // RequestResponse = sync / Event = Assync 
        Payload: JSON.stringify({
            productEvent: {
                requestId: lambdaRequestId,
                eventType: event,
                productId: product.id,
                productCode: product.code,
                productPrice: product.price,
                email: email
            }
        })
    }

    return lambdaClient.invoke(params).promise()
}

function getAllProducts(){
    const params = {
        TableName: productsDdb
    }

    return ddbClient.scan(params).promise()
}

function getProductsById(productId){
    const params = {
        TableName: productsDdb,
        Key: {
            id: productId
        }
    }

    return ddbClient.get(params).promise()
}

function createProduct(product){
    const params = {
        TableName: productsDdb,
        Item: {
            id: product.id, 
            productName: product.productName,
            code: product.code, 
            price: product.price,
            model: product.model,
            productUrl: product.productUrl
        }
    }
    return ddbClient.put(params).promise()
}

function updateProduct(productId, product){
    const params = {
        TableName: productsDdb,
        Key: {
            id: productId
        },
        UpdateExpression: "set productName = :n, code = :c, price = :p, model = :m, productUrl = :u", 
        ExpressionAttributeValues: {
            ":n": product.productName,
            ":c": product.code, 
            ":p": product.price,
            ":m": product.model,
            ":u": product.productUrl,
        }
    }
    
    return ddbClient.update(params).promise()
}

function deleteProduct(productId){
    const params = {
        TableName: productsDdb, 
        Key: {
            id: productId
        }
    }

    return ddbClient.delete(params).promise()
}