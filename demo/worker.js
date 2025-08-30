/*global importScripts Supercluster */

importScripts("../dist/mutable-supercluster.js");

const now = Date.now();
let geojson;

let index;
let counter = 10;

getJSON("../test/fixtures/places.json", () => {
  console.log(
    `loaded ${geojson.features.length} points JSON in ${(Date.now() - now) / 1000}s`,
  );

  index = new Supercluster({
    log: true,
    getId: (point) => point.pointId,
  }).load(geojson.features.slice(0, 10));

  console.log(index.getTile(0, 0, 0));

  postMessage({ ready: true });
});

self.onmessage = function (e) {
  if (e.data.getClusterExpansionZoom) {
    postMessage({
      expansionZoom: index.getClusterExpansionZoom(
        e.data.getClusterExpansionZoom,
      ),
      center: e.data.center,
    });
  } else if (e.data.addPoint) {
    if (counter < geojson.features.length) {
      index.addPoint(geojson.features[counter]);
      counter++;
    }
  } else if (e.data) {
    postMessage(index.getClusters(e.data.bbox, e.data.zoom));
  }
};

function getJSON(url, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.responseType = "json";
  xhr.setRequestHeader("Accept", "application/json");
  xhr.onload = function () {
    if (
      xhr.readyState === 4 &&
      xhr.status >= 200 &&
      xhr.status < 300 &&
      xhr.response
    ) {
      geojson = xhr.response;
      callback();
    }
  };
  xhr.send();
}
