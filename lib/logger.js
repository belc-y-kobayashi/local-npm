export class Logger {
  constructor(level) {
    this.level = Number.parseInt(level) || 7;
    this.log = function log(level, label, msg, argument) {
      if (this.level > level) {
        process.emit(label, argument);
        console.log("%s %s", label ? `${label}: ` : label, msg);
      }
    };
    this.code = function code(...args) {
      this.log(1, "", args.join(","), args);
    };
    this.info = function info(...args) {
      this.log(2, "info", args.join(","), args);
    };
    this.miss = function miss(...args) {
      this.log(3, "miss", args.join(","), args);
    };
    this.hit = function hit(...args) {
      this.log(4, "hit", args.join(","), args);
    };
    this.cached = function cached(...args) {
      this.log(5, "cached", args.join(","), args);
    };
    this.request = function request(...args) {
      this.log(6, "request", args.join(","), args);
    };
    this.sync = function sync(...args) {
      this.log(7, "sync", args.join(","), args);
    };
    this.warn = function warn(...args) {
      this.log(8, "warn", args.join(","), args);
    };
    this.error = function error(...args) {
      this.log(9, "error", args.join(","), args);
    };
  }
  static getLevel(level) {
    const map = {
      "": 1,
      info: 2,
      miss: 3,
      hit: 4,
      cached: 5,
      request: 6,
      sync: 7,
      warn: 8,
      error: 9,
    };
    return map[level ? level.toLowerCase() : "error"] || 9;
  }
}
