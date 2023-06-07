const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const uuid = require("uuid")

const xRay = AWSXRay.captureAWS(require("aws-sdk"))

const productsDdb = process.env.PRODUCTS_DDB
const ordersDdb = process.env.ORDERS_DDB
const orderEvents = process.env.ORDERS_EVENTS_TOPIC_ARN
const awsRegion = process.env.AWS_REGION

AWS.config.update({
    region: awsRegion
})

const ddbClient = new AWS.DynamoDB.DocumentClient()
const snsClient = new AWS.SNS({apiVersion: '2010-03-31'})

exports.handler = async function(event, context){

    const method = event.httpMethod;
    const apiRequestId = event.requestContext.requestId;
    const lambdaRequestId = context.awsRequestId; 

    if(event.resource === '/orders'){
        if(method == 'GET'){
            if(event.queryStringParameters){
                if(event.queryStringParameters.email){
                    if(event.queryStringParameters.orderId){
                        // get one user's order
                        const data = await getOrder(event.queryStringParameters.email, 
                            event.queryStringParameters.orderId)
                        if(data.Item){
                            return {
                                body: JSON.stringify(convertToOrderResponse(data.Item))
                            }
                        }else{
                            return {
                                statusCode: 404, 
                                body: JSON.stringify('Order not found')
                            }
                        }
                    }else{
                        // get all orders from an user
                        const data = await getOrdersByEmail(event.queryStringParameters.email)
                        return {
                            body: JSON.stringify(data.Items.map(convertToOrderResponse))
                        }
                    }
                }
            }else{
                // get all orders
                const data = await getAllOrders()
                return {
                    body: JSON.stringify(data.Items.map(convertToOrderResponse))
                }
            }
        }else if(method == 'POST'){
            
            const orderRequest = JSON.parse(event.body)
            const result = await fetchProducts(orderRequest)
            if(result.Responses.products.length == orderRequest.productIds.length){
                const products = []
                result.Responses.products.forEach((product) => {
                    products.push(product)
                })

                const orderCreated = await createOrder(orderRequest, products)

                const eventResult = await sendOrderEvent(orderCreated, "ORDER_CREATED", lambdaRequestId)
                console.log(eventResult)
                return {
                    statusCode: 201, 
                    body: JSON.stringify(convertToOrderResponse(orderCreated))
                }
            }else{
                console.error('Some products were not found')
                return {
                    statusCode: 404,
                    body: JSON.stringify('Some products were not found')
                }
            }

        }else if(method == 'DELETE'){
            const data = await deleteOrder(event.queryStringParameters.email, 
                event.queryStringParameters.orderId)

            if(data.Attributes){
                const eventResult = await sendOrderEvent(data.Attributes, "ORDER_DELETED", lambdaRequestId)
                console.log(`Order deleted event sent - OrderId: ${data.Attributes.sk} - MessageId ${eventResult.MessageId}`)

                return {
                    statusCode: 200,
                    body: JSON.stringify(convertToOrderResponse(data.Attributes))
                }
            }else{
                return {
                    statusCode: 404,
                    body: JSON.stringify('Order not found')
                }
            }
        }
    }

    return{
        statusCode: 400, 
        body: JSON.stringify('Bad request')
    }
}

function sendOrderEvent(order, eventType, lambdaRequestId){
    const productCodes = []
    order.products.forEach((product) => {
        productCodes.push(product.code)
    })
    const orderEvent = {
        email: order.pk,
        sk: order.sk, 
        billing: order.billing, 
        shipping: order.shipping, 
        lambdaRequestId: lambdaRequestId,
        productCodes: productCodes
    }
    const envelope = {
        eventType,
        data: JSON.stringify(orderEvent)
    }
    const params = {
        Message: JSON.stringify(envelope), 
        TopicArn: orderEvents,
        MessageAttributes: {
            eventType: {
                DataType: "String",
                StringValue: eventType, 
            }
        }
    }

    return snsClient.publish(params).promise()
}

function getAllOrders(){
    const params = {
        TableName: ordersDdb
    }

    return ddbClient.scan(params).promise()
}

function getOrdersByEmail(email){
    const params = {
        TableName: ordersDdb, 
        KeyConditionExpression: 'pk = :email',
        ExpressionAttributeValues: {
            ':email': email
        }
    }

    return ddbClient.query(params).promise()
}

function getOrder(email, orderId){
    const params = {
        TableName: ordersDdb, 
        Key: {
            pk: email,
            sk: orderId
        },
    }

    return ddbClient.get(params).promise()
}

function deleteOrder(email, orderId){
    const params = {
        TableName: ordersDdb, 
        Key: {
            pk: email,
            sk: orderId
        },
        ReturnValues: 'ALL_OLD'
    }

    return ddbClient.delete(params).promise()
}

function fetchProducts(orderRequest){
    const keys = []
    
    orderRequest.productIds.forEach(productId => {
        keys.push({
            id: productId,
        })
    });

    const params = {
        RequestItems: {
            [productsDdb]: {
                Keys: keys
            }
        }
    }
    
    return ddbClient.batchGet(params).promise()
}

function convertToOrderResponse(order){
    return {
        email: order.pk, 
        id: order.sk,
        createdAt: order.createdAt,
        products: order.products, 
        billing: {
            payment: order.billing.payment,
            totalPrice: order.billing.totalPrice
        },
        shipping: {
            type: order.shipping.type, 
            carrier: order.shipping.carrier
        }
    }
}

async function createOrder(orderRequest, products){
    const timestamp = Date.now()
    const orderProducts = []
    let totalPrice = 0

    products.forEach((product) => {
        totalPrice += product.price 

        orderProducts.push({
            code: product.code,
            price: product.price
        })
    })

    const orderItem = {
        pk: orderRequest.email,
        sk: uuid.v4(),
        createdAt: timestamp, 
        billing: {
            payment: orderRequest.payment,
            totalPrice: totalPrice
        }, 
        shipping: {
            type: orderRequest.shipping.type, 
            carrier: orderRequest.shipping.carrier
        }, 
        products: orderProducts
    }

    await ddbClient.put({
        TableName: ordersDdb, 
        Item: orderItem
    }).promise()

    return orderItem
}