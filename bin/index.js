#!/usr/bin/env node
import program from "commander";
import packageJson from "../package.json" assert { type: "json" };
program
  .version(packageJson.version)
  .option("-p, --port [port]", "The port to run local-npm on", 5080)
  .option(
    "-pp, --pouch-port [port]",
    "The port to run the pouch db server on",
    16984,
  )
  .option(
    "-l, --log-level [level]",
    "The level to log information to the console from local-npm",
    "error",
  )
  .option(
    "-r, --remote [url]",
    "The registry to fallback information gathering and tars on",
    "https://registry.npmjs.org",
  )
  .option(
    "-rs, --remote-skim [url]",
    "The remote skimdb to sync couchdb information from",
    "https://replicate.npmjs.com",
  )
  .option(
    "-u, --url [url]",
    "The default access url that local-npm will be hosted on",
    "http://127.0.0.1:5080",
  )
  .option("-d, --directory [directory]", "directory to store data", "./")
  .parse(process.argv);

import server from "../lib/index.js";
server({
  port: program.port,
  pouchPort: program.pouchPort,
  logLevel: program.logLevel,
  remote: program.remote,
  remoteSkim: program.remoteSkim,
  url: program.url,
  directory: program.directory,
});
