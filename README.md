## ECommerce com CDK (AWS) 

Este projeto visa criar uma infraestrutura na AWS utilizando o framework CDK, com a linguagem de programação Typescript e Lambdas em Javascript.
Serviços utilizados: 
- ApiGateway
- Wobsocket
- Lambda
- DynamoDB
- Cloudwatch Alarmes (e logs)
- SQS
- SNS
- IAM

## Configuração 

- Instale o AWS CLI e configure com as credenciais da sua conta com o seguinte comando:
  ```
  aws configure
  ```

- Instale as dependências do projeto:
  ```
  npm install
  ```

- Execute os comandos para deploy no ambiente:
  ```
  cdk bootstrap
  ```
  ```
  cdk deploy --all 
  ```

  Caso não queira concordar com as permissões no cmd:
  ```
  cdk deploy --all --require-approval never
  ```
  
