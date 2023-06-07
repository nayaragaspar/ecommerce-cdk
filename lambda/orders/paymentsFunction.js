const AWS = require("aws-sdk")
const AWSXRay = require("aws-xray-sdk-core")
const xRay = AWSXRay.captureAWS(require("aws-sdk"))

exports.handler = async function(event, context){
    console.log(event.Records[0])

    return {}
}