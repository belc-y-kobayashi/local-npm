import { valid, gt, satisfies } from "semver";

// find the first version in the package metadata that satisfies
// the query version. e.g. if the latest is 1.2.3, then "1", "1.2", and "1.2.3"
export default function findVersion(meta, version) {
  if (version === "latest") {
    const latestVersion = Object.keys(meta.versions)
      .filter((otherVersion) => {
        return valid(otherVersion);
      })
      .sort((a, b) => {
        return gt(a, b) ? -1 : 1;
      })[0];
    return meta.versions[latestVersion];
  }
  if (meta.versions[version]) {
    return meta.versions[version];
  }
  const versions = Object.keys(meta.versions)
    .filter((otherVersion) => {
      return valid(otherVersion) && satisfies(otherVersion, version);
    })
    .sort((a, b) => {
      return gt(a, b) ? -1 : 1;
    });
  return meta.versions[versions[0]];
}
