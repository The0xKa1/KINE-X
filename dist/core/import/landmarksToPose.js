
import { normalizeMediaPipeWorld } from "../scoring/normalize.js?v=0.1.6";



const IDENTITY                  = [0, 0, 0, 1];

// MediaPipe Pose landmark indices (33-keypoint topology).
const MP = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
}         ;

export function landmarksToPose(landmarks                      )                      {
  if (landmarks.length < 29) return null;
  const v = normalizeMediaPipeWorld(landmarks);
  if (v.length < 29) return null;

  const pelvis = midpoint(v[MP.lHip] , v[MP.rHip] );
  const chest = midpoint(v[MP.lShoulder] , v[MP.rShoulder] );
  const head = vec(v[MP.nose] );
  const spine = lerp3(pelvis, chest, 0.55);
  const neck = lerp3(chest, head, 0.4);

  const pose               = {
    pelvis: joint(pelvis),
    spine: joint(spine),
    chest: joint(chest),
    neck: joint(neck),
    head: joint(head),
    lShoulder: joint(vec(v[MP.lShoulder] )),
    rShoulder: joint(vec(v[MP.rShoulder] )),
    lElbow: joint(vec(v[MP.lElbow] )),
    rElbow: joint(vec(v[MP.rElbow] )),
    lWrist: joint(vec(v[MP.lWrist] )),
    rWrist: joint(vec(v[MP.rWrist] )),
    lHip: joint(vec(v[MP.lHip] )),
    rHip: joint(vec(v[MP.rHip] )),
    lKnee: joint(vec(v[MP.lKnee] )),
    rKnee: joint(vec(v[MP.rKnee] )),
    lAnkle: joint(vec(v[MP.lAnkle] )),
    rAnkle: joint(vec(v[MP.rAnkle] )),
  };
  return pose;
}

function joint(position            )            {
  return { position, rotation: IDENTITY };
}

function vec(p               )             {
  return [p.x, p.y, p.z];
}

function midpoint(a               , b               )             {
  return [(a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5];
}

function lerp3(a            , b            , t        )             {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
