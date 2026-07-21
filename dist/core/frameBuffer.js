import { THREE, quaternionFromTuple } from "./three-compat.js?v=0.1.8";


const orderedJoints              = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "lShoulder",
  "rShoulder",
  "lElbow",
  "rElbow",
  "lWrist",
  "rWrist",
  "lHip",
  "rHip",
  "lKnee",
  "rKnee",
  "lAnkle",
  "rAnkle",
];

export class MotionFrameBuffer {
          latestFrame                     ;
          sequence        ;

  constructor() {
    this.latestFrame = null;
    this.sequence = 0;
  }

  pushPacket(packet                   )       {
    if (packet.type !== "FRAME_STREAM") return;
    this.latestFrame = this.toRuntimeFrame(packet.data);
    this.sequence += 1;
  }

  readLatest()                      {
    return this.latestFrame;
  }

  getSequence()         {
    return this.sequence;
  }

  reset()       {
    this.latestFrame = null;
    this.sequence += 1;
  }

          toRuntimeFrame(frame             )               {
    const joints = {}                          ;
    const seedJoints = {}                              ;

    orderedJoints.forEach((joint) => {
      const source = frame.joints[joint];
      joints[joint] = {
        position: source.position,
        rotation: quaternionFromTuple(source.rotation),
      };

      const seedSource = frame.seedJoints[joint];
      seedJoints[joint] = {
        position: seedSource.position,
        rotation: quaternionFromTuple(seedSource.rotation),
      };
    });

    return {
      ...frame,
      globalTransform: {
        translation: frame.globalTransform.translation,
        rotation: quaternionFromTuple(frame.globalTransform.rotation, new THREE.Quaternion()),
      },
      seedJoints,
      joints,
      localRotations: frame.localRotations.map((rotation) => quaternionFromTuple(rotation, new THREE.Quaternion())),
    };
  }
}
