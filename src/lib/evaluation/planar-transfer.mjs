import { ownedSnapshot } from './readonly-snapshot.mjs';

const domainsOf = (value) =>
  [...value.domains].sort((a, b) => a.localeCompare(b)).join(',');
const sameScope = (base, message) =>
  base?.epoch === message.epoch && base.domains === domainsOf(message);
const fieldsOf = (snapshot) => ({
  planar: snapshot.planar,
  curves: snapshot.curves,
  regions: snapshot.regions,
});
const assertFields = (snapshot) => {
  if (
    !snapshot?.planar ||
    !Array.isArray(snapshot.curves) ||
    !Array.isArray(snapshot.regions)
  )
    throw Error('Worker 平面快照字段不完整');
};

/**
 * One acknowledged planar result per private Worker connection. The evaluator
 * derives curves/regions solely from planar for a fixed requested domain set.
 * Reuse requires exact cached object identity, never a geometry/name heuristic.
 */
export function createPlanarTransferEncoder() {
  let base = null;
  return {
    encode(request, snapshot) {
      if (!request.planarTransfer) return { snapshot };
      assertFields(snapshot);
      if (
        sameScope(base, request) &&
        request.planarBase === base.token &&
        snapshot.planar === base.planar
      ) {
        const {
          planar: _planar,
          curves: _curves,
          regions: _regions,
          ...rest
        } = snapshot;
        return { snapshot: rest, planarBase: base.token };
      }
      base = {
        epoch: request.epoch,
        domains: domainsOf(request),
        token: crypto.randomUUID(),
        planar: snapshot.planar,
      };
      return { snapshot, planarToken: base.token };
    },
  };
}

/** The caller validates response identity before decoding this private frame. */
export function createPlanarTransferDecoder() {
  let base = null;
  return {
    capture(request) {
      // Retain this value with its request; other responses can replace base.
      return sameScope(base, request) ? base : null;
    },
    decode(response, capturedBase) {
      if (response.planarBase !== undefined) {
        if (
          !sameScope(capturedBase, response) ||
          response.planarBase !== capturedBase.token ||
          response.planarToken !== undefined ||
          ['planar', 'curves', 'regions'].some((key) =>
            Object.hasOwn(response.snapshot, key),
          )
        )
          throw Error('Worker 平面快照基准不匹配');
        return ownedSnapshot({ ...response.snapshot, ...capturedBase.fields });
      }
      assertFields(response.snapshot);
      const snapshot = ownedSnapshot(response.snapshot);
      base =
        typeof response.planarToken === 'string' && response.planarToken
          ? Object.freeze({
              epoch: response.epoch,
              domains: domainsOf(response),
              token: response.planarToken,
              fields: Object.freeze(fieldsOf(snapshot)),
            })
          : null;
      return snapshot;
    },
  };
}
