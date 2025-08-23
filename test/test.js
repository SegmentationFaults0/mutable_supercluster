
import test from 'node:test';
import assert from 'node:assert/strict';

import {readFileSync} from 'fs';
import Supercluster from '../index.js';

const getId = point => point.pointId;

const compareFn = (a, b) => a.geometry[0][0] - b.geometry[0][0] ||
                            a.geometry[0][1] - b.geometry[0][1] ||
                            a.geometry[0][2] - b.geometry[0][2] ||
                            a.geometry[0][3] - b.geometry[0][3];

const places = JSON.parse(readFileSync(new URL('./fixtures/places.json', import.meta.url)));
const placesTile = JSON.parse(readFileSync(new URL('./fixtures/places-z0-0-0.json', import.meta.url)));
const sortedTileFeatures = placesTile.features.sort(compareFn);
const placesTileMin5 = JSON.parse(readFileSync(new URL('./fixtures/places-z0-0-0-min5.json', import.meta.url)));
const sortedTileMin5Features = placesTileMin5.features.sort(compareFn);

test('generates clusters properly', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    const tile = index.getTile(0, 0, 0);
    tile.features.sort(compareFn);
    assert.deepEqual(tile.features, sortedTileFeatures);
});

test('supports minPoints option', () => {
    const index = new Supercluster({minPoints: 5, getId}).load(structuredClone(places.features));
    const tile = index.getTile(0, 0, 0);
    tile.features.sort(compareFn);
    assert.deepEqual(tile.features, sortedTileMin5Features);
});

test('returns children of a cluster', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    const childCounts = index.getChildren(164).map(p => p.properties.point_count || 1);
    assert.deepEqual(childCounts, [1, 7, 2, 6]);
});

test('returns leaves of a cluster', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    const leafNames = index.getLeaves(164, 10, 5).map(p => p.properties.name);
    assert.deepEqual(leafNames, [
        'I. de Cozumel',
        'Cabo Gracias a Dios',
        'Grand Cayman',
        'Cape Bauld',
        'Miquelon',
        'Cape May',
        'Niagara Falls',
        'Cape Hatteras',
        'Cape Fear',
        'Cape Sable',
    ]);
});

test('generates unique ids with generateId option', () => {
    const index = new Supercluster({generateId: true, getId}).load(structuredClone(places.features));
    const ids = index.getTile(0, 0, 0).features.filter(f => !f.tags.cluster).map(f => f.id);
    assert.deepEqual(ids, [62,  24, 22,  12, 28, 20, 125, 119, 30, 118, 81, 21, 81, 118]);
});

test('getLeaves handles null-property features', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features).concat([{
        type: 'Feature',
        properties: null,
        geometry: {
            type: 'Point',
            coordinates: [-79.04411780507252, 43.08771393436908]
        }
    }]));
    const leaves = index.getLeaves(165, 1, 12);
    assert.equal(leaves[0].properties, null);
});

test('returns cluster expansion zoom', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    assert.deepEqual(index.getClusterExpansionZoom(164), 1);
    assert.deepEqual(index.getClusterExpansionZoom(196), 1);
    assert.deepEqual(index.getClusterExpansionZoom(581), 2);
    assert.deepEqual(index.getClusterExpansionZoom(1157), 2);
    assert.deepEqual(index.getClusterExpansionZoom(4134), 3);
});

test('returns cluster expansion zoom for maxZoom', () => {
    const index = new Supercluster({
        radius: 60,
        extent: 256,
        maxZoom: 4,
        getId
    }).load(structuredClone(places.features));

    assert.deepEqual(index.getClusterExpansionZoom(2504), 5);
});

test('aggregates cluster properties with reduce', () => {
    const index = new Supercluster({
        map: props => ({sum: props.scalerank}),
        reduce: (a, b) => { a.sum += b.sum; },
        radius: 100,
        getId
    }).load(structuredClone(places.features));

    assert.deepEqual(index.getTile(1, 0, 0).features.map(f => f.tags.sum).filter(Boolean),
        [8, 19, 12, 23, 146, 34, 8, 29, 84, 63, 35, 80]);
    assert.deepEqual(index.getTile(0, 0, 0).features.map(f => f.tags.sum).filter(Boolean),
        [8,  7, 24, 125, 298, 12, 122, 36, 98,  98, 125, 12, 36,  8]);
});

test('returns clusters when query crosses international dateline', () => {
    const index = new Supercluster({getId}).load([
        {
            type: 'Feature',
            properties: null,
            geometry: {
                type: 'Point',
                coordinates: [-178.989, 0]
            }
        }, {
            type: 'Feature',
            properties: null,
            geometry: {
                type: 'Point',
                coordinates: [-178.990, 0]
            }
        }, {
            type: 'Feature',
            properties: null,
            geometry: {
                type: 'Point',
                coordinates: [-178.991, 0]
            }
        }, {
            type: 'Feature',
            properties: null,
            geometry: {
                type: 'Point',
                coordinates: [-178.992, 0]
            }
        }
    ]);

    const nonCrossing = index.getClusters([-179, -10, -177, 10], 1);
    const crossing = index.getClusters([179, -10, -177, 10], 1);

    assert.ok(nonCrossing.length);
    assert.ok(crossing.length);
    assert.equal(nonCrossing.length, crossing.length);
});

test('does not crash on weird bbox values', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    assert.equal(index.getClusters([129.426390, -103.720017, -445.930843, 114.518236], 1).length, 26);
    assert.equal(index.getClusters([112.207836, -84.578666, -463.149397, 120.169159], 1).length, 27);
    assert.equal(index.getClusters([129.886277, -82.332680, -445.470956, 120.390930], 1).length, 26);
    assert.equal(index.getClusters([458.220043, -84.239039, -117.137190, 120.206585], 1).length, 25);
    assert.equal(index.getClusters([456.713058, -80.354196, -118.644175, 120.539148], 1).length, 25);
    assert.equal(index.getClusters([453.105328, -75.857422, -122.251904, 120.732760], 1).length, 25);
    assert.equal(index.getClusters([-180, -90, 180, 90], 1).length, 61);
});

test('does not crash on non-integer zoom values', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    assert.ok(index.getClusters([179, -10, -177, 10], 1.25));
});

test('makes sure same-location points are clustered', () => {
    const index = new Supercluster({
        maxZoom: 20,
        extent: 8192,
        radius: 16,
        getId
    }).load([
        {type: 'Feature', geometry: {type: 'Point', coordinates: [-1.426798, 53.943034]}},
        {type: 'Feature', geometry: {type: 'Point', coordinates: [-1.426798, 53.943034]}}
    ]);

    assert.equal(index.clusterData[20].length, 6);
});

test('makes sure unclustered point coords are not rounded', () => {
    const index = new Supercluster({maxZoom: 19, getId}).load([
        {type: 'Feature', geometry: {type: 'Point', coordinates: [173.19150559062456, -41.340357424709275]}}
    ]);

    assert.deepEqual(index.getTile(20, 1028744, 656754).features[0].geometry[0], [421, 281]);
});

test('does not throw on zero items', () => {
    assert.doesNotThrow(() => {
        const index = new Supercluster({getId}).load([]);
        assert.deepEqual(index.getClusters([-180, -85, 180, 85], 0), []);
    });
});

test('update properties succeeds', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    const leafNames = index.getLeaves(164, 3, 5).map(p => p.properties.name);
    assert.deepEqual(leafNames, [
        'I. de Cozumel',
        'Cabo Gracias a Dios',
        'Grand Cayman',
    ]);
    // Update name of point 160, currently named I. de Cozumel.
    index.updatePointProperties(160, {properties: {name: 'New York'}});
    const newLeafNames = index.getLeaves(164, 3, 5).map(p => p.properties.name);
    assert.deepEqual(newLeafNames, [
        'New York',
        'Cabo Gracias a Dios',
        'Grand Cayman',
    ]);
});

test('update properties with different location fails', () => {
    const index = new Supercluster({getId}).load(structuredClone(places.features));
    // Change location of point 160 and try to update.
    index.updatePointProperties(160, {geometry: {coordinates: [0, 0]}});
    // Result should not have changed.
    const leafNames = index.getLeaves(164, 3, 5).map(p => p.properties.name);
    assert.deepEqual(leafNames, [
        'I. de Cozumel',
        'Cabo Gracias a Dios',
        'Grand Cayman',
    ]);
});
