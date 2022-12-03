import { Socket } from 'node:net';
import { createServer } from 'node:http';
import { Duplex, pipeline, Readable } from 'node:stream';
import { ReadableStream, WritableStream } from 'node:stream/web';
import { Command } from 'commander';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { exit } from 'node:process';
import * as url from 'node:url';
import * as undici from 'undici';
import { concatStreams } from './helper';

let config: {
  port: string;
  address: string;
  uuid: string;
  config: string;
} = null;
const program = new Command();
program
  .command('run')
  .description('launch local http proxy for edge pass')
  .option(
    '--config <config>',
    'address of remote proxy, etc https://***.deno.dev/'
  )
  .option(
    '--address <address>',
    'address of remote proxy, etc https://***.deno.dev/'
  )
  .option('--port <port>', 'local port of http proxy proxy', '8134')
  .option('--uuid <uuid>', 'uuid')
  .option('--save', 'if this is pass, will save to config.json')
  .action((options) => {
    if (options.config) {
      if (existsSync(options.config)) {
        const content = readFileSync(options.config, {
          encoding: 'utf-8',
        });
        config = JSON.parse(content);
        return;
      } else {
        console.error('config not exsit!');
        exit();
      }
    }
    config = options;
    if (options.save) {
      writeFileSync('./config.json', JSON.stringify(options), {
        encoding: 'utf-8',
      });
    }
  });
program.parse();

let httpProxyServer = createServer((req, resp) => {
  console.log('start');
  const reqUrl = url.parse(req.url);
  console.log('proxy for http request: ' + reqUrl.href);

  req.pipe(resp);
});

httpProxyServer.on('connect', (req, clientSocket, head) => {
  const reqUrl = url.parse('https://' + req.url);
  console.log(
    `Client Connected To Proxy, client http version is ${
      req.httpVersion
    }, client url is ${req.url},head is ${head.toString()}`
  );
  // We need only the data once, the starting packet
  clientSocket.write(
    `HTTP/${req.httpVersion} 200 Connection Established\r\n\r\n`
  );

  pipeline(
    concatStreams([head, clientSocket]),
    undici.pipeline(
      config.address,
      {
        headers: {
          'x-host': reqUrl.hostname,
          'x-port': reqUrl.port,
          'x-uuid': config.uuid,
          // "Content-Type": "text/plain",
        },
        method: 'POST',
      },
      ({ statusCode, headers, body }) => {
        console.log(
          `proxy to ${reqUrl.hostname}:${reqUrl.port} and remote return ${statusCode}`
        );
        // body.on();
        return pipeline(body, clientSocket, (error) => {
          console.log('server response to clientSocket return error', error);
        });
      }
    ),
    (error) => {
      console.log('clientSocket request to server error', error);
    }
  );

  clientSocket.on('error', (e) => {
    console.log('client socket error: ' + e);
  });
  clientSocket.on('end', () => {
    console.log('end-----');
  });
});

httpProxyServer.on('error', (err) => {
  console.log('SERVER ERROR');
  console.log(err);
  throw err;
});
httpProxyServer.on('clientError', (err, clientSocket) => {
  console.log('client error: ' + err);
  clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

httpProxyServer.on('close', () => {
  console.log('Client Disconnected');
});

httpProxyServer.listen(Number(config.port), () => {
  console.log('Server runnig at http://localhost:' + config.port);
});
