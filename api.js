const serverless = require('serverless-http');
const app = require('../../app');
const db = require('../../database/db');

// Handler serverless para o Netlify
const serverlessHandler = serverless(app);

module.exports.handler = async (event, context) => {
  // Garantir que a conexão ao banco está inicializada antes de processar a requisição
  context.callbackWaitsForEmptyEventLoop = false;
  await db.initializeDatabase();
  return await serverlessHandler(event, context);
};
