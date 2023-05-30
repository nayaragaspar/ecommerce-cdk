import * as cdk from "@aws-cdk/core";
import * as apigateway from "@aws-cdk/aws-apigateway";
import * as lambdaNodeJS from "@aws-cdk/aws-lambda-nodejs";

interface ECommerceApiStackProps extends cdk.StackProps {
    productsHandler: lambdaNodeJS.NodejsFunction, 
    ordersHandler: lambdaNodeJS.NodejsFunction, 
    orderEventsFetchHandler: lambdaNodeJS.NodejsFunction
}

export class ECommerceApiStack extends cdk.Stack {

    constructor(scope: cdk.Construct, id: string, props: ECommerceApiStackProps){
        super(scope, id, props)

        const apiGW = new apigateway.RestApi(this, "ecommerce-api", {
            restApiName: "Ecommerce Service",
            description: "This is the Ecommerce service"
        })

        const productRequestValidator = new apigateway.RequestValidator(this, "ProductValidator", {
            restApi: apiGW, 
            requestValidatorName: 'Product request validaor',
            validateRequestBody: true
        })

        const productModel = new apigateway.Model(this, 'ProductModel', {
            modelName: 'ProductModel',
            restApi: apiGW, 
            contentType: 'application/json',
            schema: {
                type: apigateway.JsonSchemaType.OBJECT, 
                properties: {
                    productName: {
                        type: apigateway.JsonSchemaType.STRING
                    },
                    code: {
                        type: apigateway.JsonSchemaType.STRING,
                    },
                    price: {
                        type: apigateway.JsonSchemaType.NUMBER,
                    },
                    model: {
                        type: apigateway.JsonSchemaType.STRING,
                    },
                    productUrl: {
                        type: apigateway.JsonSchemaType.STRING,
                    },
                },
                required: ['productName', 'code']
            }
        })

        const productsFunctionIntegration = new apigateway.LambdaIntegration(props.productsHandler)

        const productsResource = apiGW.root.addResource("products");
        // GET /products
        productsResource.addMethod("GET", productsFunctionIntegration);
        // POST /products
        productsResource.addMethod("POST", productsFunctionIntegration, {
            requestValidator: productRequestValidator, 
            requestModels: {'application/json': productModel}
        });

        // GET /products/{id}
        const productResourceId = productsResource.addResource("{id}");
        productResourceId.addMethod("GET", productsFunctionIntegration);
        // PUT /products/{id}
        productResourceId.addMethod("PUT", productsFunctionIntegration);
        // DELETE /products/{id}
        productResourceId.addMethod("DELETE", productsFunctionIntegration);
    
        const ordersFunctionIntegration = new apigateway.LambdaIntegration(props.ordersHandler)
        // /orders 
        const ordersResource = apiGW.root.addResource("orders")
        // GET /orders
        // GET /orders?email=email@email.com
        // GET /orders?email=email@email.com&orderId=123
        ordersResource.addMethod("GET", ordersFunctionIntegration)

        // DELETE /orders?email=email@email.com&orderId=123
        ordersResource.addMethod("DELETE", ordersFunctionIntegration, {
            requestParameters: {
                'method.request.querystring.email': true,
                'method.request.querystring.orderId': true,
            },
            requestValidatorOptions: {
                requestValidatorName: "Email and Order Id validator",
                validateRequestParameters: true
            }
        })

        const orderRequestValidator = new apigateway.RequestValidator(this, "OrderValidator", {
            restApi: apiGW, 
            requestValidatorName: 'Oder request validaor',
            validateRequestBody: true
        })

        const orderModel = new apigateway.Model(this, 'OrderModel', {
            modelName: 'OrderModel',
            restApi: apiGW, 
            contentType: 'application/json',
            schema: {
                type: apigateway.JsonSchemaType.OBJECT, 
                properties: {
                    email: {
                        type: apigateway.JsonSchemaType.STRING
                    },
                    productIds: {
                        type: apigateway.JsonSchemaType.ARRAY,
                        minItems: 1,
                        items: {
                            type: apigateway.JsonSchemaType.STRING
                        }, 
                    },
                    payment: {
                        type: apigateway.JsonSchemaType.STRING,
                        enum: ['CASH', 'DEBIT_CARD', 'CREDIT_CARD']
                    },
                },
                required: ['email', 'productIds']
            }
        })

        // POST /orders
        const postOrder = ordersResource.addMethod("POST", ordersFunctionIntegration, {
            requestValidator: orderRequestValidator, 
            requestModels: {'application/json': orderModel}
        })

        const key = apiGW.addApiKey("ApiKey")
        const plan = apiGW.addUsagePlan("UsagePlan", {
            name: "Basic Plan",
            throttle: {
                rateLimit: 4,
                burstLimit: 2
            },
            quota: {
                limit: 5,
                period: apigateway.Period.DAY
            }
        })
        plan.addApiKey(key)
        plan.addApiStage({
            stage: apiGW.deploymentStage, 
            throttle: [
                {
                    method: postOrder,
                    throttle: {
                        rateLimit: 4, 
                        burstLimit: 2
                    }
                }
            ]
        })

        const orderEventsFetchintegration = new apigateway.LambdaIntegration(props.orderEventsFetchHandler)
        
        //resource 
        const orderEventsFetchResource = ordersResource.addResource('events')

        orderEventsFetchResource.addMethod("GET", orderEventsFetchintegration)

    }
}