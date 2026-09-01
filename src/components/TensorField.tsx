import { useEffect, useRef } from "react";
import * as THREE from "three";

const NODE_COLORS = [new THREE.Color("#101820"), new THREE.Color("#ff6038"), new THREE.Color("#7657d8")];

export function TensorField() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const compact = window.matchMedia("(max-width: 720px)").matches;
    const probe = document.createElement("canvas");
    if (!probe.getContext("webgl2") && !probe.getContext("webgl")) return;
    const nodeCount = compact ? 62 : 108;
    const maxSegments = nodeCount * (compact ? 7 : 12);
    const bounds = compact
      ? new THREE.Vector3(5.2, 4.6, 2.2)
      : new THREE.Vector3(7.6, 4.3, 2.8);
    const connectionDistance = compact ? 1.7 : 1.9;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
    camera.position.set(0, 0, compact ? 10.8 : 10.2);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !compact,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }
    renderer.setClearColor(0xffffff, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.35 : 1.75));
    renderer.domElement.setAttribute("role", "presentation");
    mount.appendChild(renderer.domElement);

    const field = new THREE.Group();
    scene.add(field);

    const positions = new Float32Array(nodeCount * 3);
    const pointColors = new Float32Array(nodeCount * 3);
    const velocities = Array.from({ length: nodeCount }, () =>
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.014,
        (Math.random() - 0.5) * 0.012,
        (Math.random() - 0.5) * 0.008,
      ),
    );

    for (let index = 0; index < nodeCount; index += 1) {
      const offset = index * 3;
      positions[offset] = (Math.random() - 0.5) * bounds.x * 2;
      positions[offset + 1] = (Math.random() - 0.5) * bounds.y * 2;
      positions[offset + 2] = (Math.random() - 0.5) * bounds.z * 2;
      const color = NODE_COLORS[index % NODE_COLORS.length];
      pointColors[offset] = color.r;
      pointColors[offset + 1] = color.g;
      pointColors[offset + 2] = color.b;
    }

    const pointGeometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    pointGeometry.setAttribute("position", positionAttribute);
    pointGeometry.setAttribute("color", new THREE.BufferAttribute(pointColors, 3));

    const points = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        size: compact ? 0.105 : 0.085,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.86,
        vertexColors: true,
        depthWrite: false,
      }),
    );
    const halos = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        color: "#ff6038",
        size: compact ? 0.28 : 0.22,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
      }),
    );
    field.add(halos, points);

    const linePositions = new Float32Array(maxSegments * 6);
    const lineColors = new Float32Array(maxSegments * 6);
    const lineGeometry = new THREE.BufferGeometry();
    const linePositionAttribute = new THREE.BufferAttribute(linePositions, 3);
    linePositionAttribute.setUsage(THREE.DynamicDrawUsage);
    const lineColorAttribute = new THREE.BufferAttribute(lineColors, 3);
    lineColorAttribute.setUsage(THREE.DynamicDrawUsage);
    lineGeometry.setAttribute("position", linePositionAttribute);
    lineGeometry.setAttribute("color", lineColorAttribute);
    const lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: compact ? 0.2 : 0.24,
        depthWrite: false,
      }),
    );
    field.add(lines);

    const first = new THREE.Vector3();
    const second = new THREE.Vector3();
    const mixedColor = new THREE.Color();

    function rebuildConnections() {
      let segmentCount = 0;
      for (let firstIndex = 0; firstIndex < nodeCount && segmentCount < maxSegments; firstIndex += 1) {
        first.fromArray(positions, firstIndex * 3);
        for (let secondIndex = firstIndex + 1; secondIndex < nodeCount; secondIndex += 1) {
          second.fromArray(positions, secondIndex * 3);
          const distance = first.distanceTo(second);
          if (distance > connectionDistance) continue;

          const positionOffset = segmentCount * 6;
          linePositions.set(
            [first.x, first.y, first.z, second.x, second.y, second.z],
            positionOffset,
          );
          const blend = Math.min(0.82, distance / connectionDistance);
          mixedColor.copy(NODE_COLORS[firstIndex % NODE_COLORS.length]).lerp(
            NODE_COLORS[secondIndex % NODE_COLORS.length],
            blend,
          );
          lineColors.set(
            [mixedColor.r, mixedColor.g, mixedColor.b, mixedColor.r, mixedColor.g, mixedColor.b],
            positionOffset,
          );
          segmentCount += 1;
          if (segmentCount >= maxSegments) break;
        }
      }
      lineGeometry.setDrawRange(0, segmentCount * 2);
      linePositionAttribute.needsUpdate = true;
      lineColorAttribute.needsUpdate = true;
    }

    function moveNodes(delta: number) {
      for (let index = 0; index < nodeCount; index += 1) {
        const offset = index * 3;
        positions[offset] += velocities[index].x * delta;
        positions[offset + 1] += velocities[index].y * delta;
        positions[offset + 2] += velocities[index].z * delta;
        if (Math.abs(positions[offset]) > bounds.x) velocities[index].x *= -1;
        if (Math.abs(positions[offset + 1]) > bounds.y) velocities[index].y *= -1;
        if (Math.abs(positions[offset + 2]) > bounds.z) velocities[index].z *= -1;
      }
      positionAttribute.needsUpdate = true;
    }

    const pointerTarget = new THREE.Vector2();
    const pointerCurrent = new THREE.Vector2();
    const onPointerMove = (event: PointerEvent) => {
      pointerTarget.set(
        (event.clientX / window.innerWidth - 0.5) * 0.18,
        (event.clientY / window.innerHeight - 0.5) * 0.12,
      );
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let frame = 0;
    let inView = true;
    let previousTime = performance.now();
    const render = (time: number) => {
      const delta = Math.min((time - previousTime) / 16.667, 2.4);
      previousTime = time;
      moveNodes(delta);
      rebuildConnections();
      pointerCurrent.lerp(pointerTarget, 0.035);
      field.rotation.x = -0.035 + pointerCurrent.y;
      field.rotation.y += 0.00034 * delta;
      field.rotation.z = pointerCurrent.x * 0.35;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };

    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const start = () => {
      if (reducedMotion || frame || !inView || document.hidden) return;
      previousTime = performance.now();
      frame = window.requestAnimationFrame(render);
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) start();
      else stop();
    });
    intersectionObserver.observe(mount);
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    rebuildConnections();
    renderer.render(scene, camera);
    start();

    return () => {
      stop();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      pointGeometry.dispose();
      lineGeometry.dispose();
      (points.material as THREE.Material).dispose();
      (halos.material as THREE.Material).dispose();
      (lines.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="hero-tensor-field" ref={mountRef} aria-hidden="true" />;
}
