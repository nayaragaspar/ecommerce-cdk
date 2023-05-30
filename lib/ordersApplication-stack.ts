import * as lambda from "@aws-cdk/aws-lambda"
import * as lambdaNodeJS from "@aws-cdk/aws-lambda-nodejs"
import * as cdk from "@aws-cdk/core"
import * as dynamodb from "@aws-cdk/aws-dynamodb"
import * as sns from "@aws-cdk/aws-sns"
import * as subs from "@aws-cdk/aws-sns-subscriptions"
import * as iam from "@aws-cdk/aws-iam"
import * as sqs from "@aws-cdk/aws-sqs"
import * as lambdaEventSource from "@aws-cdk/aws-lambda-event-sources"
import * as logs from '@aws-cdk/aws-logs'
import * as cw from '@aws-cdk/aws-cloudwatch'

interface OrdersApplicationStackProps extends cdk.StackProps{
    productsDdb: dynamodb.Table,
    eventsDdb: dynamodb.Table
}

export class OrdersApplicationStack extends cdk.Stack{
    readonly ordersHandler: lambdaNodeJS.NodejsFunction
    readonly orderEventsFetchHandler: lambdaNodeJS.NodejsFunction

    constructor(scope: cdk.Construct, id: string, props: OrdersApplicationStackProps){
        super(scope, id, props);

        const ordersDdb = new dynamodb.Table(this, "ordersDdb", {
            tableName: "orders",
            partitionKey: {
                name: "pk",
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: "sk", 
                type: dynamodb.AttributeType.STRING
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 1, 
            writeCapacity: 1
        })
        // Metric
        const writeThrottleEventsMetric = ordersDdb.metric('WriteThrottleEvents', {
            period: cdk.Duration.minutes(2),
            statistic: 'SampleCount',
            unit: cw.Unit.COUNT
        })
        // Alarm 
        writeThrottleEventsMetric.createAlarm(this, "WriteThrottleEvents", {
            alarmName: 'WriteThrottleEvents', 
            actionsEnabled: false, 
            evaluationPeriods: 1,
            threshold: 25,
            comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cw.TreatMissingData.NOT_BREACHING
        })
        
        /*const readScale = ordersDdb.autoScaleReadCapacity({
            maxCapacity: 4, 
            minCapacity: 1
        })
        readScale.scaleOnUtilization({
            targetUtilizationPercent: 20, 
            scaleInCooldown:cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(20)
        })

        const writeScale = ordersDdb.autoScaleWriteCapacity({
            maxCapacity: 4, 
            minCapacity: 1
        })
        writeScale.scaleOnUtilization({
            targetUtilizationPercent: 20, 
            scaleInCooldown:cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(30)
        })*/

        const ordersTopic = new sns.Topic(this, "OrdersEventsTopic", {
            displayName: "Orders Events Topic",
            topicName: "order-events",
        })

        this.ordersHandler = new lambdaNodeJS.NodejsFunction(this, "ordersFunction", {
            functionName: "ordersFunction", 
            entry: "lambda/orders/ordersFunction.js",
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
                PRODUCTS_DDB: props.productsDdb.tableName, 
                ORDERS_DDB: ordersDdb.tableName,
                ORDERS_EVENTS_TOPIC_ARN: ordersTopic.topicArn
            }
        })

        props.productsDdb.grantReadData(this.ordersHandler)
        ordersDdb.grantReadWriteData(this.ordersHandler)
        ordersTopic.grantPublish(this.ordersHandler)

        const orderEmailDlq = new sqs.Queue(this, 'orderEmailDlq', {
            queueName: 'order-email-dlq',
        })

        const orderEventsHandler = new lambdaNodeJS.NodejsFunction(this, "orderEventsFunction", {
            functionName: "orderEventsFunction", 
            entry: "lambda/orders/orderEventsFunction.js",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            deadLetterQueue: orderEmailDlq,
            //reservedConcurrentExecutions: 5,
            bundling: {
                minify: false, 
                sourceMap: false,
            },
            environment: {
                EVENTS_DDB: props.eventsDdb.tableName, 
            }
        })
        ordersTopic.addSubscription(new subs.LambdaSubscription(orderEventsHandler))
        const eventsDdbPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["dynamodb:PutItem"], 
            resources: [props.eventsDdb.tableArn],
            conditions: {
                ['ForAllValues:StringLike']:{
                    'dynamodb:LeadingKeys': ['#order_*']
                }
            }
        })
        orderEventsHandler.addToRolePolicy(eventsDdbPolicy)

        const paymentsHandler = new lambdaNodeJS.NodejsFunction(this, "paymentsFunction", {
            functionName: "paymentsFunction", 
            entry: "lambda/orders/paymentsFunction.js",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(10),
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            deadLetterQueueEnabled: true,
            bundling: {
                minify: false, 
                sourceMap: false,
            },
        })
        ordersTopic.addSubscription(new subs.LambdaSubscription(paymentsHandler, {
            filterPolicy: {
                eventType: sns.SubscriptionFilter.stringFilter({
                    allowlist: ['ORDER_CREATED'],
                    //denylist: ['ORDER_DELETED', 'ORDER_UPDATED']
                })
            }
        }))

        const orderEventsDlq = new sqs.Queue(this, 'orderEventsDlq', {
            queueName: 'order-event-dlq',
            retentionPeriod: cdk.Duration.days(10)
        })

        const orderEventsQueue = new sqs.Queue(this, "OrderEventsQueue", {
            queueName: 'order-event', 
            deadLetterQueue: {
                maxReceiveCount: 3, 
                queue: orderEventsDlq
            }
        })
        ordersTopic.addSubscription(new subs.SqsSubscription(orderEventsQueue, {
            filterPolicy: {
                eventType: sns.SubscriptionFilter.stringFilter({
                    allowlist: ['ORDER_CREATED'],
                })
            }
        }))

        const orderEmailsHandler = new lambdaNodeJS.NodejsFunction(this, "orderEmailsFunction", {
            functionName: "orderEmailsFunction", 
            entry: "lambda/orders/orderEmailsFunction.js",
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
        orderEmailsHandler.addEventSource(new lambdaEventSource.SqsEventSource(orderEventsQueue, {
            batchSize: 5, 
            enabled: true, 
            maxBatchingWindow: cdk.Duration.seconds(10)
        }))
        orderEventsQueue.grantConsumeMessages(orderEmailsHandler)

        const orderEmailSesPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["ses:SendEmail", "ses:SendRowEmail"],
            resources: ["*"]
        })
        orderEmailsHandler.addToRolePolicy(orderEmailSesPolicy)
    
        this.orderEventsFetchHandler = new lambdaNodeJS.NodejsFunction(this, "orderEventsFetchFunction", {
            functionName: "orderEventsFetchFunction", 
            entry: "lambda/orders/orderEventsFetchFunction.js",
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
                EVENTS_DDB: props.eventsDdb.tableName
            }
        })
        const eventsFethcDdbPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:Query'],
            resources: [`${props.eventsDdb.tableArn}/index/emailIdx`],
            /*conditions: {
                ['ForAllValues:StringLike']:{
                    'dynamodb:LeadingKeys': ['order_*']
                }
            }*/
        })
        this.orderEventsFetchHandler.addToRolePolicy(eventsFethcDdbPolicy)   

        // Metric 
        const numberOfMessagesMetric = orderEmailDlq.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(2), 
            statistic: 'Sum'
        })
        // alarm
        numberOfMessagesMetric.createAlarm(this, 'OrderEmailFail', {
            alarmName: 'OrderEmailFail',
            actionsEnabled: false,
            evaluationPeriods: 1, 
            threshold: 5,
            comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
        })

        // Metric 
        const ageOfMessageMetric = orderEmailDlq.metricApproximateAgeOfOldestMessage({
            period: cdk.Duration.minutes(2), 
            statistic: 'Maximum',
            unit: cw.Unit.SECONDS
        })
        // Alarm 
        ageOfMessageMetric.createAlarm(this, 'AgeOfMessageInQueue', {
            alarmName: 'AgeOfMessagesQueue',
            alarmDescription: ' Maximum age of Messages in order events Queue', 
            actionsEnabled: false, 
            evaluationPeriods: 1, 
            threshold: 60, 
            comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
        })

        // Metric 
        const productNotFoundMetricFilter = this.ordersHandler.logGroup.addMetricFilter('ProductNotFound',{
            filterPattern: logs.FilterPattern.literal('Some products were not found'),
            metricName: 'OrderWithNotFoundProduct', 
            metricNamespace: 'ProductNotFound'
        })

        // Alarm 
        const productNotFoundAlarm = productNotFoundMetricFilter.metric()
            .with({
                period: cdk.Duration.minutes(2),
                statistic: 'Sum'
            })
            .createAlarm(this, "ProductNotFoundAlarm", {
                alarmName: "OrderWithNotValidProduct",
                alarmDescription: "Some product were not found while creatinf order", 
                evaluationPeriods: 1, 
                threshold: 2,
                actionsEnabled: true,
                comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
            })

        // Alarm Action
        const orderAlarmTopic = new sns.Topic(this, "OrderAlarmsTopic", {
            displayName: "OrderAlarmsTopic",
            topicName: "order-alarms"
        })
        orderAlarmTopic.addSubscription(new subs.EmailSubscription('nayaradenisegaspar@gmail.com'))
        
        productNotFoundAlarm.addAlarmAction({
            bind(): cw.AlarmActionConfig{
                return { alarmActionArn: orderAlarmTopic.topicArn }
            }
        })
    }
}
