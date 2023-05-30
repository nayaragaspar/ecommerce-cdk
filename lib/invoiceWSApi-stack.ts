import * as lambda from "@aws-cdk/aws-lambda"
import * as lambdaNodeJS from "@aws-cdk/aws-lambda-nodejs"
import * as cdk from "@aws-cdk/core"
import * as dynamodb from "@aws-cdk/aws-dynamodb"
import * as iam from "@aws-cdk/aws-iam"
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2"
import * as apigatewayv2_integrations from "@aws-cdk/aws-apigatewayv2-integrations"
import * as s3 from "@aws-cdk/aws-s3"
import * as s3n from "@aws-cdk/aws-s3-notifications"
import * as lambdaEventSource from "@aws-cdk/aws-lambda-event-sources"
import { SqsDlq } from "@aws-cdk/aws-lambda-event-sources"
import * as sqs from "@aws-cdk/aws-sqs"
import * as logs from '@aws-cdk/aws-logs'
import * as cw from '@aws-cdk/aws-cloudwatch'
import * as sns from "@aws-cdk/aws-sns"
import * as subs from "@aws-cdk/aws-sns-subscriptions"

interface InvoiceWSApiStackProps extends cdk.StackProps{
    eventsDdb: dynamodb.Table
}

export class InvoiceWSApiStack extends cdk.Stack{
    constructor(scope: cdk.Construct, id: string, props: InvoiceWSApiStackProps){
        super(scope, id, props);

        /// Invoice and invoice transaction DDB
        const invoicesDdb = new dynamodb.Table(this, "InvoicesDdb", {
            tableName: "invoices",
            partitionKey: {
                name: "pk",
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: "sk", 
                type: dynamodb.AttributeType.STRING
            },
            timeToLiveAttribute: "ttl",
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        })

        /// Invoice bucket
        const bucket = new s3.Bucket(this, "InvoiceBucket", {
            bucketName: "ndg-invoices",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        })

        /// WS connection handler 
        const connectionHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceConnectionFunction", {
            functionName: "InvoiceConnectionFunction", 
            entry: "lambda/invoices/invoiceConnectionFunction.js",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            bundling: {
                minify: false, 
                sourceMap: false,
            },
        })

        /// WS disconnection handler 
        const disconnectionHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceDisconnectionFunction", {
            functionName: "InvoiceDisconnectionFunction", 
            entry: "lambda/invoices/invoiceDisconnectionFunction.js",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            bundling: {
                minify: false, 
                sourceMap: false,
            },
        })

        /// WS API
        const webSocketApi = new apigatewayv2.WebSocketApi(this, "InvoiceWSApi", {
            apiName: "InvoiceApi",
            connectRouteOptions: {
                integration: new apigatewayv2_integrations.LambdaWebSocketIntegration({
                    handler: connectionHandler
                })
            },
            disconnectRouteOptions: {
                integration: new apigatewayv2_integrations.LambdaWebSocketIntegration({
                    handler: disconnectionHandler
                })
            },
        })

        const stage = 'prod'
        const wsApiEndpoint = `${webSocketApi.apiEndpoint}/${stage}`

        new apigatewayv2.WebSocketStage(this, "InvoiceWSApiStage", {
            webSocketApi,
            stageName: stage,
            autoDeploy: true
        })

        const resourcePost = `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${stage}/POST/@connections/*`
        const resourceGet = `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${stage}/GET/@connections/*`
        const resourceDelete = `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${stage}/DELETE/@connections/*`
        
        const wsApiPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['execute-api:ManageConnections'],
            resources: [resourcePost, resourceGet, resourceDelete]
        })

        /// Invoice URL handler 
        const getUrlHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceGetUrlFunction", {
            functionName: "InvoiceGetUrlFunction", 
            entry: "lambda/invoices/invoiceGetUrlFunction.js",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            bundling: {
                minify: false, 
                sourceMap: false,
            },
            environment: {
                INVOICES_DDB: invoicesDdb.tableName,
                BUCKET_NAME: bucket.bucketName,
                INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
            }
        })

        const invoicesDdbWriteTransactionPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:PutItem'],
            resources:[invoicesDdb.tableArn],
            conditions:{
                ['ForAllValues:StringLike']:{
                    'dynamodb:LeadingKeys': ['#transaction']
                }
            }
        })
        const invoiceBucketPutObjectPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:PutObject'],
            resources: [`${bucket.bucketArn}/*`]
        })

        getUrlHandler.addToRolePolicy(invoiceBucketPutObjectPolicy)
        getUrlHandler.addToRolePolicy(wsApiPolicy)
        getUrlHandler.addToRolePolicy(invoicesDdbWriteTransactionPolicy)

        /// Invoice import handler 
        const invoiceImportHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceImportFunction", {
            functionName: "InvoiceImportFunction", 
            entry: "lambda/invoices/invoiceImportFunction.js",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            bundling: {
                minify: false, 
                sourceMap: false,
            },
            environment: {
                INVOICES_DDB: invoicesDdb.tableName,
                INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
            }
        })
        const invoicesBucketGetDeleteObjectPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:DeleteObject', 's3:GetObject'],
            resources: [`${bucket.bucketArn}/*`]
        })
        invoiceImportHandler.addToRolePolicy(invoicesBucketGetDeleteObjectPolicy)
        invoicesDdb.grantReadWriteData(invoiceImportHandler)
        invoiceImportHandler.addToRolePolicy(wsApiPolicy)

        bucket.addEventNotification(s3.EventType.OBJECT_CREATED_PUT, new s3n.LambdaDestination(invoiceImportHandler))
        
        // ========= ADD ALARM TO IMPORT INVOICE
        // Metric 
        const noInvoiceNumberMetricFilter = invoiceImportHandler.logGroup.addMetricFilter('NoInvoiceNumberImport',{
            filterPattern: logs.FilterPattern.literal('No invoice number'),
            metricName: 'NoInvoiceNumberImport', 
            metricNamespace: 'NoInvoiceNumberImport'
        })

        // Alarm 
        const noInvoiceNumberAlarm = noInvoiceNumberMetricFilter.metric()
            .with({
                period: cdk.Duration.minutes(2),
                statistic: 'Sum'
            })
            .createAlarm(this, "noInvoiceNumberImport", {
                alarmName: "noInvoiceNumberImport",
                evaluationPeriods: 1, 
                threshold: 2,
                actionsEnabled: true,
                comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
            })

        // Alarm Action
        const noInvoiceNumberImportTopic = new sns.Topic(this, "noInvoiceNumberImportTopic", {
            displayName: "noInvoiceNumberImportTopic",
            topicName: "invoice-alarms"
        })
        noInvoiceNumberImportTopic.addSubscription(new subs.EmailSubscription('nayaradenisegaspar@gmail.com'))
        
        noInvoiceNumberAlarm.addAlarmAction({
            bind(): cw.AlarmActionConfig{
                return { alarmActionArn: noInvoiceNumberImportTopic.topicArn }
            }
        })

        // =======================

        /// Cancel invoice import handler 

        /// WS API routes 
        webSocketApi.addRoute('getImportUrl', {
            integration: new apigatewayv2_integrations.LambdaWebSocketIntegration({
                handler: getUrlHandler
            })
        })

        /// Invoice Events Stream 
        const invoiceEventsHandler = new lambdaNodeJS.NodejsFunction(this, "invoiceEventsFunction", {
            functionName: "invoiceEventsFunction", 
            entry: "lambda/invoices/invoiceEventsFunction.js",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            bundling: {
                minify: false, 
                sourceMap: false,
            },
            environment: {
                EVENTS_DDB: props.eventsDdb.tableName,
                INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
            }
        })
        const eventsDdbPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["dynamodb:PutItem"], 
            resources: [props.eventsDdb.tableArn],
            conditions: {
                ['ForAllValues:StringLike']:{
                    'dynamodb:LeadingKeys': ['#invoice_*']
                }
            }
        })

        invoiceEventsHandler.addToRolePolicy(eventsDdbPolicy)
        invoiceEventsHandler.addToRolePolicy(wsApiPolicy)
        
        const invoiceEventsDlq = new sqs.Queue(this, "InvoiceEventsDlq", {
            queueName: 'invoice-events-dlq',
            retentionPeriod: cdk.Duration.days(10)
        })

        invoiceEventsHandler.addEventSource(
            new lambdaEventSource.DynamoEventSource( invoicesDdb, {
                startingPosition: lambda.StartingPosition.TRIM_HORIZON,
                batchSize: 5,
                bisectBatchOnError: true,
                onFailure: new SqsDlq(invoiceEventsDlq),
                retryAttempts: 3
            })
        )
    }
}