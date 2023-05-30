#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { ProductsFunctionStack } from '../lib/productsFunction-stack'
import { ECommerceApiStack } from '../lib/ecommerceApi-stack'
import { ProductsDdbStack } from '../lib/productsDDb-stack';
import { EventsDdbStack } from '../lib/eventsDdb-stack';
import { OrdersApplicationStack } from '../lib/ordersApplication-stack';
import { InvoiceWSApiStack } from '../lib/invoiceWSApi-stack';

const app = new cdk.App();
const env = {
  region: 'us-west-1'
}

const tags = {
  ost: "ECommerce",
    team: "Team CX"
}

const eventsDdbStack = new EventsDdbStack(app, 'EventsDdb', {
  env: env, 
  tags: tags
})

const productsDDbStack = new ProductsDdbStack(app, "ProductsDdb", {
  env: env,
  tags: tags
})

const productsFunctionStack = new ProductsFunctionStack(app, "ProductsFunction", {
  productsDdb: productsDDbStack.table, 
  eventsDdb: eventsDdbStack.table,
  env: env,
  tags: tags
})
productsFunctionStack.addDependency(productsDDbStack)
productsFunctionStack.addDependency(eventsDdbStack)

const ordersApplicationStack = new OrdersApplicationStack(app, "OrdersApplication", {
  productsDdb: productsDDbStack.table, 
  eventsDdb: eventsDdbStack.table,
  env: env,
  tags: tags
})
ordersApplicationStack.addDependency(productsDDbStack)
ordersApplicationStack.addDependency(eventsDdbStack)

const eCommerceApiStack = new ECommerceApiStack(app, "ECommerceApi", {
  productsHandler: productsFunctionStack.productHandler,
  ordersHandler: ordersApplicationStack.ordersHandler,
  orderEventsFetchHandler: ordersApplicationStack.orderEventsFetchHandler,
  env: env,
  tags: tags
})
eCommerceApiStack.addDependency(productsFunctionStack)
eCommerceApiStack.addDependency(ordersApplicationStack)

const invoiceWSApiStack = new InvoiceWSApiStack(app, "InvoiceApi", {
  eventsDdb: eventsDdbStack.table,
  env: env,
  tags: {
    cost: "InvoiceApp", 
    team: "Team CXNDG"
  }
})
invoiceWSApiStack.addDependency(eventsDdbStack)