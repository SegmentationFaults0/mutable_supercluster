
import RBush from 'rbush';
import {merge as lodashMerge} from 'lodash-es';

class MyRBush extends RBush {
    // eslint-disable-next-line class-methods-use-this
    toBBox([x, y]) { return {minX: x, minY: y, maxX: x, maxY: y}; }
    // eslint-disable-next-line class-methods-use-this
    compareMinX(a, b) { return a[0] - b[0]; }
    // eslint-disable-next-line class-methods-use-this
    compareMinY(a, b) { return a[1] - b[1]; }
}

const defaultOptions = {
    minZoom: 0,   // min zoom to generate clusters on
    maxZoom: 16,  // max zoom level to cluster the points on
    minPoints: 2, // minimum points to form a cluster
    radius: 40,   // cluster radius in pixels
    extent: 512,  // tile extent (radius is calculated relative to it)
    zoomFactor: 2, // the factor with which the detail increases each zoom level
    nodeSize: 9, // size of the R-tree nodes, affects performance
    log: false,   // whether to log timing info

    // whether to generate numeric ids for input features (in vector tiles)
    generateId: false,

    // a reduce function for calculating custom cluster properties
    reduce: null, // (accumulated, props) => { accumulated.sum += props.sum; }

    // properties to use for individual points when running the reducer
    map: props => props, // props => ({sum: props.my_value})

    // a function that maps a point to its (externally provided) Id
    getId: null
};

const fround = Math.fround || (tmp => ((x) => { tmp[0] = +x; return tmp[0]; }))(new Float32Array(1));

const OFFSET_ZOOM = 2;
const OFFSET_ID = 3;
const OFFSET_PARENT = 4;
const OFFSET_NUM = 5;
const OFFSET_PROP = 6;

function pushClusterData(clusterData, reduce, x, y, zoom, id, parent, numPoints, properties) {
    clusterData.push(
        x, y, // projected point coordinates
        zoom, // the last zoom the point was processed at
        id, // index of the source feature in the original input array
        parent, // parent cluster id
        numPoints // number of points in a cluster
    );
    if (reduce) clusterData.push(properties); // noop
}

export default class Supercluster {
    constructor(options) {
        this.options = Object.assign(Object.create(defaultOptions), options);
        if (!this.options.getId) throw new Error('The Id access function (options.getId) can not be null');
        this.trees = new Array(this.options.maxZoom + 1);
        this.clusterData = new Array(this.options.maxZoom + 1);
        this.stride = this.options.reduce ? 7 : 6;
        this.clusterProps = [];
        this.getId = this.options.getId;
    }

    load(points) {
        const {log, minZoom, maxZoom} = this.options;

        if (log) console.time('total time');

        const timerId = `prepare ${  points.length  } points`;
        if (log) console.time(timerId);

        this.points = structuredClone(points);
        points.length = 0;

        // generate a cluster object for each point and index input points into a R-tree
        const currentClusterData = [];
        const currentIndexData = [];

        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            if (!p.geometry) continue;

            const [lng, lat] = p.geometry.coordinates;
            const x = fround(lngX(lng));
            const y = fround(latY(lat));
            // store internal point/cluster data in flat numeric arrays for performance
            pushClusterData(currentClusterData, this.options.reduce, x, y, Infinity, i, -1, 1, 0);


            // populate indexData-array because R-Tree needs an array of separate items.
            // TODO: possible optimization is forking RBush repo and change this to be more like KDBush?
            currentIndexData.push([x, y, i]);
        }
        this.trees[maxZoom + 1] = this._createTree(currentIndexData);
        this.clusterData[maxZoom + 1] = currentClusterData;

        if (log) console.timeEnd(timerId);

        // cluster points on max zoom, then cluster the results on previous zoom, etc.;
        // results in a cluster hierarchy across zoom levels
        for (let z = maxZoom; z >= minZoom; z--) {
            const now = +Date.now();

            // create a new set of clusters for the zoom and index them with a R-tree
            const newIndexData = this._cluster(z);
            this.trees[z] = this._createTree(newIndexData);

            if (log) console.log('z%d: %d clusters in %dms', z, newIndexData.length, +Date.now() - now);
        }

        if (log) console.timeEnd('total time');

        return this;
    }

    getClusters(bbox, zoom) {
        let minLng = ((bbox[0] + 180) % 360 + 360) % 360 - 180;
        const minLat = Math.max(-90, Math.min(90, bbox[1]));
        let maxLng = bbox[2] === 180 ? 180 : ((bbox[2] + 180) % 360 + 360) % 360 - 180;
        const maxLat = Math.max(-90, Math.min(90, bbox[3]));

        if (bbox[2] - bbox[0] >= 360) {
            minLng = -180;
            maxLng = 180;
        } else if (minLng > maxLng) {
            const easternHem = this.getClusters([minLng, minLat, 180, maxLat], zoom);
            const westernHem = this.getClusters([-180, minLat, maxLng, maxLat], zoom);
            return easternHem.concat(westernHem);
        }

        const z = this._limitZoom(zoom);
        const ids = this._rbushRange(z, lngX(minLng), latY(maxLat), lngX(maxLng), latY(minLat));
        const data = this.clusterData[z];
        const clusters = [];
        for (const id of ids) {
            const k = this.stride * id;
            clusters.push(data[k + OFFSET_NUM] > 1 ? getClusterJSON(data, k, this.clusterProps) : this.points[data[k + OFFSET_ID]]);
        }
        return clusters;
    }

    getChildren(clusterId) {
        const originId = getOriginIdx(clusterId);
        const originZoom = getOriginZoom(clusterId);
        const errorMsg = 'No cluster with the specified id.';

        if (!this.trees[originZoom]) throw new Error(errorMsg);

        const data = this.clusterData[originZoom];
        if (originId * this.stride >= data.length) throw new Error(errorMsg);

        const r = this.options.radius / (this.options.extent * Math.pow(this.options.zoomFactor, originZoom - 1));
        const x = data[originId * this.stride];
        const y = data[originId * this.stride + 1];
        const ids = this._rbushWithin(x, y, originZoom, r);
        const children = [];
        for (const id of ids) {
            const k = id * this.stride;
            if (data[k + OFFSET_PARENT] === clusterId) {
                children.push(data[k + OFFSET_NUM] > 1 ? getClusterJSON(data, k, this.clusterProps) : this.points[data[k + OFFSET_ID]]);
            }
        }

        if (children.length === 0) throw new Error(errorMsg);

        return children;
    }

    getLeaves(clusterId, limit, offset) {
        limit = limit || 10;
        offset = offset || 0;

        const leaves = [];
        this._appendLeaves(leaves, clusterId, limit, offset, 0);

        return leaves;
    }

    getTile(z, x, y) {
        const zoom = this._limitZoom(z);
        const data = this.clusterData[zoom];
        const {extent, radius, zoomFactor} = this.options;
        const z2 = Math.pow(zoomFactor, z);
        const p = radius / extent;
        const top = (y - p) / z2;
        const bottom = (y + 1 + p) / z2;

        const tile = {
            features: []
        };

        this._addTileFeatures(
            this._rbushRange(zoom, (x - p) / z2, top, (x + 1 + p) / z2, bottom),
            data, x, y, z2, tile);
        if (x === 0) {
            this._addTileFeatures(
                this._rbushRange(zoom, 1 - p / z2, top, 1, bottom),
                data, z2, y, z2, tile);
        }
        if (x === z2 - 1) {
            this._addTileFeatures(
                this._rbushRange(zoom, 0, top, p / z2, bottom),
                data, -1, y, z2, tile);
        }

        return tile.features.length ? tile : null;
    }

    getClusterExpansionZoom(clusterId) {
        let expansionZoom = getOriginZoom(clusterId) - 1;
        while (expansionZoom <= this.options.maxZoom) {
            const children = this.getChildren(clusterId);
            expansionZoom++;
            if (children.length !== 1) break;
            clusterId = children[0].properties.cluster_id;
        }
        return expansionZoom;
    }

    updatePointProperties(id, properties) {
        const idx = this._linearSearchInPoints(id);
        if (!idx) throw new Error('No point with the given id could be found.');

        const clonedProperties = structuredClone(properties);
        delete clonedProperties.geometry?.coordinates;
        lodashMerge(this.points[idx], clonedProperties);
    }

    addPoint(point) {
        const {maxZoom, reduce} = this.options;
        const p = structuredClone(point);
        this.points.push(p);
        if (!p.geometry) return;
        const [lng, lat] = p.geometry.coordinates;
        const x = fround(lngX(lng));
        const y = fround(latY(lat));
        this.clusterData[maxZoom + 1].push(
            x, y, // projected point coordinates
            Infinity, // the last zoom the point was processed at
            this.points.length - 1, // index of the source feature in the original input array
            -1, // parent cluster id
            1 // number of points in a cluster
        );
        if (reduce) this.clusterData[maxZoom + 1].push(0);
        this.trees[maxZoom + 1].insert([x, y, this.points.length - 1]);

        // for (let z = maxZoom; z >= minZoom; z--) {}
    }

    _appendLeaves(result, clusterId, limit, offset, skipped) {
        const children = this.getChildren(clusterId);

        for (const child of children) {
            const props = child.properties;

            if (props && props.cluster) {
                if (skipped + props.point_count <= offset) {
                    // skip the whole cluster
                    skipped += props.point_count;
                } else {
                    // enter the cluster
                    skipped = this._appendLeaves(result, props.cluster_id, limit, offset, skipped);
                    // exit the cluster
                }
            } else if (skipped < offset) {
                // skip a single point
                skipped++;
            } else {
                // add a single point
                result.push(child);
            }
            if (result.length === limit) break;
        }

        return skipped;
    }

    _createTree(data) {
        const tree = new MyRBush(this.options.nodeSize);
        tree.load(data);
        return tree;
    }

    _addTileFeatures(ids, data, x, y, z2, tile) {
        for (const i of ids) {
            const k = i * this.stride;
            const isCluster = data[k + OFFSET_NUM] > 1;

            let tags, px, py;
            if (isCluster) {
                tags = getClusterProperties(data, k, this.clusterProps);
                px = data[k];
                py = data[k + 1];
            } else {
                const p = this.points[data[k + OFFSET_ID]];
                tags = p.properties;
                const [lng, lat] = p.geometry.coordinates;
                px = lngX(lng);
                py = latY(lat);
            }

            const f = {
                type: 1,
                geometry: [[
                    Math.round(this.options.extent * (px * z2 - x)),
                    Math.round(this.options.extent * (py * z2 - y))
                ]],
                tags
            };

            // assign id
            let id;
            if (isCluster || this.options.generateId) {
                // optionally generate id for points
                id = data[k + OFFSET_ID];
            } else {
                // keep id if already assigned
                id = this.points[data[k + OFFSET_ID]].id;
            }

            if (id !== undefined) f.id = id;

            tile.features.push(f);
        }
    }

    _limitZoom(z) {
        return Math.max(this.options.minZoom, Math.min(Math.floor(+z), this.options.maxZoom + 1));
    }

    _cluster(zoom) {
        const {radius, extent, reduce, minPoints, zoomFactor} = this.options;
        const r = radius / (extent * Math.pow(zoomFactor, zoom));
        const data = this.clusterData[zoom + 1];
        const nextClusterData = [];
        const nextIndexData = [];
        const stride = this.stride;

        // loop through each point
        for (let i = 0; i < data.length; i += stride) {
            // if we've already visited the point at this zoom level, skip it
            if (data[i + OFFSET_ZOOM] <= zoom) continue;
            data[i + OFFSET_ZOOM] = zoom;

            // find all nearby points
            const x = data[i];
            const y = data[i + 1];
            const neighborIds = this._rbushWithin(data[i], data[i + 1], zoom + 1, r);

            const numPointsOrigin = data[i + OFFSET_NUM];
            let numPoints = numPointsOrigin;

            // count the number of points in a potential cluster
            for (const neighborId of neighborIds) {
                const k = neighborId * stride;
                // filter out neighbors that are already processed
                if (data[k + OFFSET_ZOOM] > zoom) numPoints += data[k + OFFSET_NUM];
            }

            // if there were neighbors to merge, and there are enough points to form a cluster
            if (numPoints > numPointsOrigin && numPoints >= minPoints) {
                let wx = x * numPointsOrigin;
                let wy = y * numPointsOrigin;

                let clusterProperties;
                let clusterPropIndex = -1;

                // encode both zoom and point index on which the cluster originated
                const id = -(((i / stride | 0) << 5) + (zoom + 1));

                for (const neighborId of neighborIds) {
                    const k = neighborId * stride;

                    if (data[k + OFFSET_ZOOM] <= zoom) continue;
                    data[k + OFFSET_ZOOM] = zoom; // save the zoom (so it doesn't get processed twice)

                    const numPoints2 = data[k + OFFSET_NUM];
                    wx += data[k] * numPoints2; // accumulate coordinates for calculating weighted center
                    wy += data[k + 1] * numPoints2;

                    data[k + OFFSET_PARENT] = id;

                    if (reduce) {
                        if (!clusterProperties) {
                            clusterProperties = this._map(data, i, true);
                            clusterPropIndex = this.clusterProps.length;
                            this.clusterProps.push(clusterProperties);
                        }
                        reduce(clusterProperties, this._map(data, k));
                    }
                }

                data[i + OFFSET_PARENT] = id;
                nextIndexData.push([wx / numPoints, wy / numPoints, nextIndexData.length]);
                nextClusterData.push(wx / numPoints, wy / numPoints, Infinity, id, -1, numPoints);
                if (reduce) nextClusterData.push(clusterPropIndex);

            } else { // left points as unclustered
                nextIndexData.push([data[i], data[i + 1], nextIndexData.length]);
                for (let j = 0; j < stride; j++) nextClusterData.push(data[i + j]);

                if (numPoints > 1) {
                    for (const neighborId of neighborIds) {
                        const k = neighborId * stride;
                        if (data[k + OFFSET_ZOOM] <= zoom) continue;
                        data[k + OFFSET_ZOOM] = zoom;
                        nextIndexData.push([data[k], data[k + 1], nextIndexData.length]);
                        for (let j = 0; j < stride; j++) nextClusterData.push(data[k + j]);
                    }
                }
            }
        }
        this.clusterData[zoom] = nextClusterData;
        return nextIndexData;
    }

    _map(data, i, clone) {
        if (data[i + OFFSET_NUM] > 1) {
            const props = this.clusterProps[data[i + OFFSET_PROP]];
            return clone ? Object.assign({}, props) : props;
        }
        const original = this.points[data[i + OFFSET_ID]].properties;
        const result = this.options.map(original);
        return clone && result === original ? Object.assign({}, result) : result;
    }

    _rbushWithin(ax, ay, zoom, radius) {
        const r2 = radius * radius;
        const pointsInSquare = this.trees[zoom].search({minX: ax - radius, minY: ay - radius, maxX: ax + radius, maxY: ay + radius});
        return pointsInSquare.filter(([bx, by]) => sqDist(ax, ay, bx, by) <= r2).map(point => point[2]);
    }

    _rbushRange(zoom, minX, minY, maxX, maxY) {
        const result = [];
        const pointsInBox = this.trees[zoom].search({minX, minY, maxX, maxY});
        for (const point of pointsInBox) result.push(point[2]);
        return result;
    }

    _linearSearchInPoints(id) {
        const index = this.points.findIndex(p => this.getId(p) === id);
        return index !== -1 ? index : null;
    }
}

// get index of the point from which the cluster originated
function getOriginIdx(clusterId) {
    if (clusterId >= 0) throw new Error('A cluster id should be negative');
    return (-clusterId) >> 5;
}

// get zoom of the point from which the cluster originated
function getOriginZoom(clusterId) {
    if (clusterId >= 0) throw new Error('A cluster id should be negative');
    return (-clusterId) % 32;
}

function getClusterJSON(data, i, clusterProps) {
    return {
        type: 'Feature',
        id: data[i + OFFSET_ID],
        properties: getClusterProperties(data, i, clusterProps),
        geometry: {
            type: 'Point',
            coordinates: [xLng(data[i]), yLat(data[i + 1])]
        }
    };
}

function getClusterProperties(data, i, clusterProps) {
    const count = data[i + OFFSET_NUM];
    const abbrev =
        count >= 10000 ? `${Math.round(count / 1000)  }k` :
        count >= 1000 ? `${Math.round(count / 100) / 10  }k` : count;
    const propIndex = data[i + OFFSET_PROP];
    const properties = propIndex === -1 ? {} : Object.assign({}, clusterProps[propIndex]);

    return Object.assign(properties, {
        cluster: true,
        'cluster_id': data[i + OFFSET_ID],
        'point_count': count,
        'point_count_abbreviated': abbrev
    });
}

// longitude/latitude to spherical mercator in [0..1] range
function lngX(lng) {
    return lng / 360 + 0.5;
}
function latY(lat) {
    const sin = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);
    return y < 0 ? 0 : y > 1 ? 1 : y;
}

// spherical mercator to longitude/latitude
function xLng(x) {
    return (x - 0.5) * 360;
}
function yLat(y) {
    const y2 = (180 - y * 360) * Math.PI / 180;
    return 360 * Math.atan(Math.exp(y2)) / Math.PI - 90;
}

function sqDist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}
