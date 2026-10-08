import * as THREE from 'three';

const eye = new THREE.Vector3(), target = new THREE.Vector3();

/** Prefer cover and space over a distant spawn watched by multiple enemies. */
export function spawnScore(position, enemies, friends, world, variation = 0) {
  let nearest = 120, danger = 0, crowd = 0;
  target.copy(position); target.y += 1.4;
  for (const enemy of enemies) {
    const distance = enemy.pos.distanceTo(position);
    nearest = Math.min(nearest, distance);
    if (distance < 12) danger += (12 - distance) * 8;
    if (distance < 65) {
      eye.copy(enemy.pos); eye.y += enemy.eyeH || 1.5;
      if (world.lineOfSight(eye, target)) danger += 55 * (1 - distance / 100);
    }
    if (distance < 1.2) crowd += 1000;
  }
  for (const friend of friends) {
    const distance = friend.pos.distanceTo(position);
    if (distance < 2) crowd += 50;
    if (distance < 1.2) crowd += 1000;
  }
  if (world.overlaps(position.x, position.y + 0.05, position.z, 0.4, 1.8)) crowd += 2000;
  return Math.min(nearest, 60) - danger - crowd + Math.min(6, Math.max(0, variation));
}
