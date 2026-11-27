(function () {
  'use strict';

  const T = window.THREE;
  if (!T.GLTFLoader || location.protocol === 'file:') return;
  const scriptUrl = document.currentScript.src;
  const assets = new URL(scriptUrl ? '../assets/heads/' : 'assets/heads/', scriptUrl || document.baseURI);
  const roster = new Set(['fan', 'ma', 'wang', 'harimoto', 'sun', 'ovtcharov']);
  const version = 'fullbody-3';

  const model = window.PP.wangModel;
  const buildFallback = model.buildHead;
  const loader = new T.GLTFLoader();
  const pending = new Map();

  async function loadHead(key) {
    const url = new URL(key + '.glb', assets);
    url.searchParams.set('v', version);
    const gltf = await loader.loadAsync(url.href);

    const head = gltf.scene;
    const bounds = new T.Box3().setFromObject(head);
    const size = bounds.getSize(new T.Vector3());
    const center = bounds.getCenter(new T.Vector3());
    if (size.y <= 0) throw new Error('头模尺寸无效');

    // 收窄原头模底部的肩颈外沿，让低头和转头时的底边也能藏进领口。
    const point = new T.Vector3();
    head.traverse(part => {
      if (!part.isMesh || !part.material.map) return;
      const position = part.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        part.localToWorld(point.fromBufferAttribute(position, i));
        const distance = (point.y - bounds.min.y) / size.y;
        if (distance >= 0.27) continue;
        const t = 1 - distance / 0.27;
        const weight = t * t * (3 - 2 * t);
        point.x += (center.x - point.x) * weight * 0.52;
        point.z += (center.z - size.z * 0.18 - point.z) * weight * 0.62;
        part.worldToLocal(point);
        position.setXYZ(i, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
      part.geometry.computeBoundingBox();
      part.geometry.computeBoundingSphere();
    });

    // 以颈部为定位基准，适配角色现有的抬头、转头和球衣领口。
    const scale = 0.318 / size.y;
    head.scale.setScalar(scale);
    head.position.set(-center.x * scale, -0.211 - bounds.min.y * scale, 0.024 - center.z * scale);

    let texture;
    head.traverse(part => {
      if (part.isMesh) {
        part.castShadow = true;
        part.receiveShadow = !part.material.map;
        texture = texture || part.material.map;
      }
    });
    if (!texture) throw new Error('头模缺少面部贴图');
    texture.anisotropy = 4;
    return { head, texture };
  }

  model.buildHead = function (three, skin, character) {
    const group = buildFallback(three, skin, character);
    if (!roster.has(character)) return group;

    // 同一球员跨预览和对局共享已解码的几何与贴图。
    if (!pending.has(character)) {
      pending.set(character, loadHead(character).catch(error => {
        pending.delete(character);
        throw error;
      }));
    }
    pending.get(character).then(({ head, texture }) => {
      group.clear();
      group.add(head.clone(true));
      group.userData.faceTexture = texture;
      group.userData.modelSource = 'web-roster';
      delete group.userData.updateExpression;
    }).catch(error => console.warn('无法载入球员头模', character, error));
    return group;
  };
})();
