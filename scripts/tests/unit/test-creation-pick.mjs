import assert from 'node:assert/strict';
import { pickVisibleIntersection } from '../../../public/creation-pick.mjs';

const hit = (key, distance, pickOrder = 0) => ({
  distance,
  object: { userData: { key, pickOrder } },
});

assert.equal(
  pickVisibleIntersection([hit('rear', 11, 9), hit('front', 10, 0)]).object
    .userData.key,
  'front',
  'a physically nearer face remains visible regardless of draw order',
);
assert.equal(
  pickVisibleIntersection([hit('under', 10, 1), hit('shown', 10, 2)]).object
    .userData.key,
  'shown',
  'coplanar faces select the later rendered polygon-offset layer',
);
assert.equal(
  pickVisibleIntersection([hit('shown', 10, 4), hit('under', 10, 1)]).object
    .userData.key,
  'shown',
  'coplanar selection does not depend on Three raycast traversal order',
);
assert.equal(
  pickVisibleIntersection([hit('under', 10, 1), hit('shown', 10 + 5e-8, 2)])
    .object.userData.key,
  'shown',
  'minor floating-point differences still use the coplanar draw order',
);
assert.equal(
  pickVisibleIntersection([{ distance: 1, object: { userData: {} } }]),
  null,
  'unselectable meshes are ignored',
);

console.log('creation 3D pick helper: ok');
