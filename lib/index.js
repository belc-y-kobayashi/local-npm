#!/usr/bin/env node
import { resolve as _resolve } from "node:path";
import { createHash } from "node:crypto";

import { valid } from "semver";
import express from "express";
import { Level } from "level";
import { sync as _sync } from "mkdirp";
import proxy from "express-http-proxy";

import serveStatic from "serve-static";

import { Logger } from "./logger.js";
import packageJson from "./../package.json" assert { type: "json" };
import findVersion from "./find-version.js";
import pouchServerLite from "./pouchdb-server-lite.js";
import axios from "axios";

const _version = packageJson.version;

export default (options, callback) => {
  const FAT_REMOTE = options.remote;
  const SKIM_REMOTE = options.remoteSkim;
  const port = options.port;
  const pouchPort = options.pouchPort;
  const localBase = options.url.replace(/:5080$/, `:${port}`); // port is configurable
  const directory = _resolve(options.directory);
  const logger = new Logger(Logger.getLevel(options.logLevel));
  _sync(directory);
  let startingTimeout = 1000;

  logger.code("Welcome!");
  logger.code("To start using local-npm, just run: ");
  logger.code(`   $ npm set registry ${localBase}`);
  logger.code("To switch back, you can run: ");
  logger.code(`   $ npm set registry ${FAT_REMOTE}`);

  const backoff = 1.1;
  const app = express();
  const PouchDB = pouchServerLite(options).PouchDB;

  const skimRemote = new PouchDB(SKIM_REMOTE);
  const skimLocal = new PouchDB("skimdb", {
    auto_compaction: true,
  });
  const db = new Level(_resolve(directory, "binarydb"));

  logger.code("\nA simple npm-like UI is available here");
  logger.code(`http://127.0.0.1:${port}/_browse`);

  const baseDir = process.cwd();

  app.use(serveStatic(_resolve(baseDir, "..", "dist")));
  app.use("/_browse", serveStatic(_resolve(baseDir, "..", "dist")));
  app.use("/_browse*", serveStatic(_resolve(baseDir, "..", "dist")));

  app.get("/_skimdb", redirectToSkimdb);
  app.get("/_skimdb*", redirectToSkimdb);
  app.get(
    "/-/*",
    proxy(FAT_REMOTE, {
      limit: Number.POSITIVE_INFINITY,
    }),
  );
  app.get("/", (req, res) => {
    Promise.all([skimLocal.info(), getCount()]).then((resp) => {
      res.json({
        "local-npm": "welcome",
        version: _version,
        db: resp[0],
        tarballs: resp[1],
      });
    });
  });

  //
  // utils
  //
  function redirectToSkimdb(req, res) {
    const skimUrl = `http://localhost:${pouchPort}/skimdb`;
    const url = req.originalUrl.replace(/^\/_skimdb/, skimUrl);
    axios
      .get(url, { responseType: "stream" })
      .then((response) => {
        // Pipe the response stream from Axios directly to the client
        response.data.pipe(res);
      })
      .catch((error) => {
        console.log(error);
        logger.warn("couldn't proxy to skimdb");
        logger.warn(error);
        res.status(500).send("Error proxying to skimdb");
      });
  }
  function massageMetadata(urlBase, doc) {
    const name = doc.name;
    const versions = Object.keys(doc.versions);
    for (let i = 0, len = versions.length; i < len; i++) {
      const version = versions[i];
      if (!valid(version)) {
        // apparently some npm modules like handlebars
        // have invalid semver ranges, and npm deletes them
        // on-the-fly
        delete doc.versions[version];
      } else {
        doc.versions[version].dist.tarball =
          `${urlBase}/tarballs/${name}/${version}.tgz`;
        doc.versions[version].dist.info = `${urlBase}/${name}/${version}`;
      }
    }
    return doc;
  }

  function sendBinary(res, buffer) {
    res.set("content-type", "application/octet-stream");
    res.set("content-length", buffer.length);
    return res.send(buffer);
  }

  function cacheResponse(res, etag) {
    // do this to be more like registry.npmjs.com. not sure if it
    // actually has a benefit, though
    res.set("ETag", `"${etag}"`);
    res.set("Cache-Control", "max-age=300");
  }

  function getDocument(name) {
    // Attempt to get the document from skimLocal.
    return skimLocal
      .get(name)
      .catch(() => {
        // If not found, try fetching it from skimRemote.
        return skimRemote
          .get(name)
          .then((doc) => {
            // Remove the _rev property.
            doc._rev = undefined;
            // Save the document to skimLocal.
            return skimLocal.post(doc);
          })
          .then(() => {
            // Retrieve it again from skimLocal.
            return skimLocal.get(name);
          });
      })
      .catch(() => {
        // Final fallback: request the document from FAT_REMOTE using Axios.
        const url = `${FAT_REMOTE}/${name}`;
        console.log("url");
        console.log(url);

        return axios.get(url).then((response) => {
          // Axios automatically parses JSON responses if the response headers indicate JSON.
          const data = response.data;
          data._rev = undefined;
          // Save the data to skimLocal.
          return skimLocal.post(data).then(() => {
            return skimLocal.get(name);
          });
        });
      });
  }
  function shutdown() {
    // `sync` can be undefined if you start the process while offline and
    // then immediately Ctrl-C it before you go online
    if (sync) {
      // close gracefully
      sync.cancel();
    }

    Promise.all([db.close(), skimLocal.close()])
      .catch(null)
      .then(() => {
        process.exit();
      });
  }

  function getTarLocation(dist) {
    return new Promise((resolve, reject) => {
      if (dist.info) {
        console.log("dist.info");
        console.log(dist.info);
        axios(dist.info, (error, response, body) => {
          if (error) return reject(error);
          resolve(body.dist.tarball);
        });
      } else {
        resolve(dist.tarball);
      }
    });
  }

  function downloadTar(id, tarball) {
    return new Promise((resolve, reject) => {
      const options = {
        url: tarball,
        encoding: null,
      };
      console.log("options");
      console.log(options);
      axios(options, (error, response, body) => {
        db.put(id, body)
          .then(() => {
            resolve(body);
          })
          .catch((error) => {
            reject(error);
          });
      });
    });
  }

  //
  // actual server logic
  //
  app.get("/:name/:version", (req, res) => {
    const name = req.params.name;
    const version = req.params.version;

    getDocument(name)
      .then((doc) => {
        const packageMetadata = massageMetadata(localBase, doc);
        const versionMetadata = findVersion(packageMetadata, version);
        if (versionMetadata) {
          cacheResponse(res, doc._rev);
          res.json(versionMetadata);
        } else {
          res.status(404).json({
            error: `version not found: ${version}`,
          });
        }
      })
      .catch((error) => {
        res.status(500).json({
          error,
        });
      });
  });

  app.get("/:name", (req, res) => {
    const name = req.params.name;

    getDocument(name)
      .then((doc) => {
        res.json(massageMetadata(localBase, doc));
      })
      .catch((error) => {
        res.status(500).json({
          error,
        });
      });
  });

  app.get("/tarballs/:name/:version.tgz", (req, res) => {
    const hash = createHash("sha1");
    const pkgName = req.params.name;
    const pkgVersion = req.params.version;
    const id = `${pkgName}-${pkgVersion}`;

    getDocument(pkgName)
      .then((doc) => {
        const dist = doc.versions[pkgVersion].dist;

        return db
          .get(id, {
            asBuffer: true,
            valueEncoding: "binary",
          })
          .then((buffer) => {
            hash.update(buffer);
            if (dist.shasum !== hash.digest("hex")) {
              // happens when we write garbage to disk somehow
              res.status(500).send({
                error: "hashes don't match, not returning",
              });
            } else {
              logger.hit(pkgName, pkgVersion);
              return sendBinary(res, buffer);
            }
          })
          .catch(() => {
            logger.miss(pkgName, pkgVersion);

            return getTarLocation(dist)
              .then((location) => {
                return downloadTar(id, location);
              })
              .then((tar) => {
                sendBinary(res, tar);
              })
              .catch((error) => {
                res.status(500).send(error);
              });
          });
      })
      .then(() => {
        return skimLocal.get(pkgName);
      })
      .then((doc) => {
        doc.versions[pkgVersion].downloads = doc.versions[pkgVersion].downloads
          ? doc.versions[pkgVersion].downloads + 1
          : 1;
        return skimLocal.put(doc);
      })
      .catch((error) => {
        res.status(500).send({
          error,
        });
      });
  });

  // allow support for scoped packages
  app.get("/tarballs/:user/:package/:version.tgz", (req, res) => {
    const hash = createHash("sha1");
    const userName = req.params.user;
    const pkgName = req.params.package;
    const pkgVersion = req.params.version;
    const fullName = `${userName}/${pkgName}`;
    const id = `${userName}/${pkgName}-${pkgVersion}`;

    getDocument(fullName)
      .then((doc) => {
        const dist = doc.versions[pkgVersion].dist;

        return db
          .get(id, {
            asBuffer: true,
            valueEncoding: "binary",
          })
          .then((buffer) => {
            hash.update(buffer);
            if (dist.shasum !== hash.digest("hex")) {
              // happens when we write garbage to disk somehow
              res.status(500).send({
                error: "hashes don't match, not returning",
              });
            } else {
              logger.hit(pkgName, pkgVersion);
              return sendBinary(res, buffer);
            }
          })
          .catch(() => {
            logger.miss(pkgName, pkgVersion);

            return getTarLocation(dist)
              .then((location) => {
                return downloadTar(id, location);
              })
              .then((tar) => {
                sendBinary(res, tar);
              })
              .catch((error) => {
                res.status(500).send(error);
              });
          });
      })
      .then(() => {
        return skimLocal.get(pkgName);
      })
      .then((doc) => {
        doc.versions[pkgVersion].downloads = doc.versions[pkgVersion].downloads
          ? doc.versions[pkgVersion].downloads + 1
          : 1;
        return skimLocal.put(doc);
      })
      .catch((error) => {
        res.status(500).send({
          error,
        });
      });
  });

  app.put(
    "/*",
    proxy(FAT_REMOTE, {
      limit: Number.POSITIVE_INFINITY,
    }),
  );

  let sync;

  function replicateSkim() {
    skimRemote
      .info()
      .then((info) => {
        sync = skimLocal.replicate
          .from(skimRemote, {
            live: true,
            batch_size: 200,
            retry: true,
          })
          .on("change", (change) => {
            startingTimeout = 1000;
            const percent = Math.min(
              100,
              (
                Math.floor((change.last_seq / info.update_seq) * 10000) / 100
              ).toFixed(2),
            );
            logger.sync(change.last_seq, `${percent}%`);
          })
          .on("error", (err) => {
            // shouldn't happen
            logger.warn(err);
            logger.warn(`Error during replication with ${SKIM_REMOTE}`);
          });
      })
      .catch((err) => {
        logger.warn(err);
        logger.warn(
          `Error fetching info() from ${SKIM_REMOTE}, retrying after ${Math.round(startingTimeout)} ms...`,
        );
        restartReplication();
      });
  }

  function restartReplication() {
    // just keep going
    startingTimeout *= backoff;
    setTimeout(replicateSkim, Math.round(startingTimeout));
  }

  function getCount() {
    return new Promise((fulfill, reject) => {
      let i = 0;
      db.createKeyStream()
        .on("data", () => {
          i++;
        })
        .on("end", () => {
          fulfill(i);
        })
        .on("error", reject);
    });
  }
  replicateSkim();

  process.on("SIGINT", () => {
    shutdown();
  });

  return {
    server: app.listen(port, callback),
    shutdown,
  };
};
