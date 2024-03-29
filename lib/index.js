#!/usr/bin/env node
'use strict'
const express = require('express');
const medUtils = require('openhim-mediator-utils');
const winston = require('winston');
const needle = require('needle');
const bodyParser = require('body-parser');
const utils = require('./utils');
const request = require('request');
const jsonParser = bodyParser.json();
// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, { level: 'info', timestamp: true, colorize: true })
// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = process.env.NODE_ENV === 'test' ? require('../config/test') : require('../config/config')
const mediatorConfig = require('../config/mediator')
var port = process.env.NODE_ENV === 'test' ? 7001 : mediatorConfig.endpoints[0].port
/**
* setupApp - configures the http server for this mediator
*
* @return {express.App}  the configured http server
*/
function setupApp() {
 const app = express();
 //Allow JSON parsing
 app.use(bodyParser.json({ limit: '100mb' }));
 // listen for requests coming through on /encounters/:id
 app.get('/encounters/:id', (req, res) => {
   needle.get('http://localhost:3444/encounters/' + req.params.id, function (err, resp) {
    // check if any errors occurred
    if (err) {
       console.log(err)
       return;
     }
     console.log('Reeee')

      /* ######################################### */
      /* ##### Create Initial Orchestration  ##### */
      /* ######################################### */

      // context object to store json objects
      var ctxObject = {};
      ctxObject['encounter'] = resp.body;

      //Capture 'encounter' orchestration data 
      orchestrationsResults = [];
      orchestrationsResults.push({
        name: 'Get Encounter',
        request: {
          path : req.path,
          headers: req.headers,
          querystring: req.originalUrl.replace( req.path, "" ),
          body: req.body,
          method: req.method,
          timestamp: new Date().getTime()
        },
        response: {
          status: resp.statusCode,
          body: JSON.stringify(resp.body, null, 4),
          timestamp: new Date().getTime()
        }
      });

      /* ###################################### */
      /* ##### Construct Response Object  ##### */
      /* ###################################### */

      var urn = mediatorConfig.urn;
      var status = 'Successful';
      var response = {
        status: resp.statusCode,
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(resp.body, null, 4),
        timestamp: new Date().getTime()
      };

      // construct property data to be returned - this can be anything interesting that you want to make available in core, or nothing at all
      var properties = {};
      //properties[ctxObject.encounter.observations[0].obsType] = ctxObject.encounter.observations[0].obsValue + ctxObject.encounter.observations[0].obsUnit;
      //properties[ctxObject.encounter.observations[1].obsType] = ctxObject.encounter.observations[1].obsValue + ctxObject.encounter.observations[1].obsUnit;

      // construct returnObject to be returned
      var returnObject = {
        "x-mediator-urn": urn,
        "status": status,
        "response": response,
        "orchestrations": orchestrationsResults,
        "properties": properties
      }

      //const returnObject = {};
      // res.set('Content-Type', 'application/json+openhim');
      //res.send(returnObject);
      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim');
      res.send(returnObject);
      
   });
 });

 app.post('/pushAggregateData', (req, res) => {
   const data = req.body;
   let options = {
     url: 'https//' + mediatorConfig.configAuth.username + ':' + mediatorConfig.configAuth.password + '@' + mediatorConfig.configAuth.dhis2server + '' + mediatorConfig.configAuth.endpoint ,
     // headers: { 'accept': 'application/json' },
     json: sdata
   };
   request.post(options, (err, upstreamRes, upstreamBody) => {
     if (err) {
       res.send({ error: JSON.stringify(err) })
     }
     console.log(upstreamBody)
     res.send(upstreamRes);
   })
 })

 return app

}
/**
* start - starts the mediator
*
* @param  {Function} callback a node style callback that is called once the
* server is started
*/
function start(callback) {
 if (apiConf.api.trustSelfSigned) { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' }
 if (apiConf.register) {
   medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
     if (err) {
       winston.error('Failed to register this mediator, check your config')
       winston.error(err.stack)
       process.exit(1)
     }
     apiConf.api.urn = mediatorConfig.urn
     medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
       winston.info('Received initial config:')
       winston.info(JSON.stringify(newConfig))
       config = newConfig
       if (err) {
         winston.error('Failed to fetch initial config')
         winston.error(err.stack)
         process.exit(1)
       } else {
         winston.info('Successfully registered mediator!')
         let app = setupApp()
         const server = app.listen(port, () => {
           if (apiConf.heartbeat) {
             let configEmitter = medUtils.activateHeartbeat(apiConf.api)
             configEmitter.on('config', (newConfig) => {
               winston.info('Received updated config:')
               winston.info(JSON.stringify(newConfig))
               // set new config for mediator
               config = newConfig
               // we can act on the new config received from the OpenHIM here
               winston.info(config)
             })
           }
           callback(server)
         })
       }
     })
   })
 } else {
   // default to config from mediator registration
   config = mediatorConfig.config
   let app = setupApp()
   const server = app.listen(port, () => callback(server))
 }
}
exports.start = start
if (!module.parent) {

// if this script is run directly, start the server
 start(() => winston.info(Listening on ${port}...))
}