#!/usr/bin/env node

import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

import express from "express";
import expressPouchDB from "express-pouchdb";
import PouchDB from "pouchdb";
import { Logger } from "./logger.js";

export default (options) => {
  const port = options.pouchPort;
  const directory = resolve(options.directory);
  const app = express();
  const logger = new Logger(Logger.getLevel(options.logLevel));

  // set up express-pouchdb with the prefix (directory)
  const ScopedPouchDB = PouchDB.defaults({
    prefix: `${directory}/`,
  });
  const configFile = resolve(directory, "config.json");
  const logFile = resolve(directory, "log.txt");
  // hacky, but there doesn't seem to be any other way to prefix the log file
  writeFileSync(
    configFile,
    JSON.stringify({
      log: {
        file: logFile,
      },
    }),
    "utf-8",
  );
  const pouchDBApp = expressPouchDB({
    configPath: configFile,
  });
  pouchDBApp.setPouchDB(ScopedPouchDB);
  app.use(pouchDBApp);

  app
    .listen(port, () => {
      logger.info(`PouchDB Server listening on port ${port}.`);
      logger.code(`http://localhost:${port}/_utils`);
    })
    .on(
      "error",
      /* istanbul ignore next */ (e) => {
        if (e.code === "EADDRINUSE") {
          logger.error(`Error: Port ${port} is already in use.`);
          logger.error(
            `Try another one, e.g. pouchdb-server -p ${Number.parseInt(port) + 1}\n`,
          );
        } else {
          logger.error(`Uncaught error: ${e}`);
          logger.error(e.stack);
        }
      },
    );

  return {
    app: app,
    PouchDB: ScopedPouchDB,
  };
};
