/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
import * as THREE from 'three';
import Provider from './Provider';
import TileGeometry from '../../TileGeometry';
import TileMesh from '../../TileMesh';
import CancelledCommandException from '../CancelledCommandException';
import { requestNewTile } from '../../../Process/TiledNodeProcessing';

function TileProvider() {
    Provider.call(this, null);
    this.cacheGeometry = [];
}

TileProvider.prototype = Object.create(Provider.prototype);

TileProvider.prototype.constructor = TileProvider;

TileProvider.prototype.preprocessDataLayer = function preprocessLayer(layer, view, scheduler) {
    if (!layer.schemeTile) {
        throw new Error(`Cannot init tiled layer without schemeTile for layer ${layer.id}`);
    }

    layer.level0Nodes = [];
    layer.onTileCreated = layer.onTileCreated || (() => {});
    layer.object3d.invQuaternion = layer.object3d.quaternion.clone().inverse();

    const promises = [];

    for (const root of layer.schemeTile) {
        promises.push(requestNewTile(view, scheduler, layer, root, undefined, 0));
    }
    return Promise.all(promises).then((level0s) => {
        layer.level0Nodes = level0s;
        for (const level0 of level0s) {
            layer.object3d.add(level0);
            level0.updateMatrixWorld();
        }
    });
};

const worldQuaternion = new THREE.Quaternion();
TileProvider.prototype.executeCommand = function executeCommand(command) {
    const extent = command.extent;
    if (command.requester &&
        !command.requester.material) {
        // request has been deleted
        return Promise.reject(new CancelledCommandException(command));
    }
    const layer = command.layer;
    const builder = layer.builder;
    const parent = command.requester;
    const level = (command.level === undefined) ? (parent.level + 1) : command.level;

    if (!this.cacheGeometry[level]) {
        this.cacheGeometry[level] = new Map();
    }

    const ce = builder.getCommonGeometryExtent(extent);
    const south = ce.south().toFixed(8);

    let geometry = this.cacheGeometry[level].get(south);
    // build geometry if doesn't exist
    if (!geometry) {
        const paramsGeometry = {
            extent: ce,
            level,
            segment: layer.segments || 16,
            disableSkirt: layer.disableSkirt,
        };

        geometry = new TileGeometry(paramsGeometry, builder);
        this.cacheGeometry[level].set(south, geometry);
    }

    // get geometry from cache
    // build tile
    const params = {
        layerId: layer.id,
        extent,
        level,
        materialOptions: layer.materialOptions,
    };

    builder.Center(params);
    var tile = new TileMesh(geometry, params);
    tile.layer = layer.id;
    tile.layers.set(command.threejsLayer);

    if (parent) {
        params.center.applyMatrix4(layer.object3d.matrixWorld);
        parent.worldToLocal(params.center);
    }

    tile.position.copy(params.center);

    if (builder.getQuaternionFromExtent) {
        tile.quaternion.copy(builder.getQuaternionFromExtent(geometry.extent, tile.extent));
        if (parent) {
            worldQuaternion.setFromRotationMatrix(parent.matrixWorld).premultiply(layer.object3d.invQuaternion);
            tile.quaternion.premultiply(worldQuaternion.inverse());
        }
    }

    tile.material.transparent = layer.opacity < 1.0;
    tile.material.uniforms.opacity.value = layer.opacity;
    tile.setVisibility(false);
    tile.updateMatrix();

    if (parent) {
        tile.setBBoxZ(parent.OBB().z.min, parent.OBB().z.max);
    } else if (layer.materialOptions && layer.materialOptions.useColorTextureElevation) {
        tile.setBBoxZ(layer.materialOptions.colorTextureElevationMinZ, layer.materialOptions.colorTextureElevationMaxZ);
    }

    return Promise.resolve(tile);
};

export default TileProvider;
