const AWS = require('aws-sdk');
const AWSXRay = require('aws-xray-sdk-core');
const xRay = AWSXRay.captureAWS(require('aws-sdk'));
const awsRegion = process.env.AWS_REGION;

AWS.config.update({
  region: awsRegion,
});

const sesClient = new AWS.SES({ apiVersion: '2010-12-01' });

exports.handler = async function (event, context) {
  const promises = [];

  event.Records.forEach((record) => {
    const body = JSON.parse(record.body);

    promises.push(sendOrderEmail(body));
  });

  await Promise.all(promises);

  return {};
};

function sendOrderEmail(body) {
  const envelope = JSON.parse(body.Message);
  const event = JSON.parse(envelope.data);

  const params = {
    Destination: {
      ToAddresses: [event.email],
    },
    Message: {
      Body: {
        Text: {
          Charset: 'UTF-8',
          Data: `Recebemos o seu pedido de número ${event.orderId}, no valor de ${event.billing.totalPrice}...`,
        },
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'Pedido recebido',
      },
    },
    Source: 'nayaradenisegaspar@gmail.com',
    ReplyToAddresses: ['nayaradenisefut@hotmail.com'],
  };

  return sesClient.sendEmail(params).promise();
}
