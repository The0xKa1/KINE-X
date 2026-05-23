                                                                                                        

                                         
                   
              
                     
                      
                        
                          
 

                                     
                    
                       
                     
                          
 

const COACH_CLIP_MANIFEST                           = [
  {
    exercise: "squat",
    url: "public/coach_clips/single_leg_squat.json",
    framesDir: "public/coach_clips/single_leg_squat_frames",
    frameCount: 118,
    framePattern: "frame_{i:05}.jpg",
    thumbnailCount: 18,
  },
];

                    
                                     
                                             
 

                   
             
               
              
                          
                                          
                     
                     
                       
 

const JOINT_NAMES              = [
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

export function getCoachClipManifest()                                    {
  return COACH_CLIP_MANIFEST;
}

export async function loadCoachClip(url        )                     {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to fetch coach clip ${url}: ${response.status}`);
  }
  const raw = (await response.json())           ;
  return validateClip(raw);
}

export function buildFrameThumbnails(entry                        )           {
  if (!entry.framesDir || !entry.frameCount || !entry.framePattern) return [];
  return buildFrameThumbnailsFromMeta({
    framesDir: entry.framesDir,
    framePattern: entry.framePattern,
    frameCount: entry.frameCount,
    thumbnailCount: entry.thumbnailCount,
  });
}

export function buildFrameThumbnailsFromMeta(meta                    )           {
  const total = meta.frameCount;
  if (total <= 0) return [];
  const count = Math.min(meta.thumbnailCount ?? 18, total);
  const denom = Math.max(1, count - 1);
  const out           = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i / denom) * (total - 1)) + 1;
    out.push(`${meta.framesDir}/${formatFrameName(meta.framePattern, idx)}`);
  }
  return out;
}

function formatFrameName(pattern        , index        )         {
  return pattern.replace(/\{i:(\d+)\}/g, (_, widthStr) => {
    const width = Number(widthStr);
    return String(index).padStart(width, "0");
  });
}

function validateClip(raw         )            {
  if (!Array.isArray(raw.frames) || raw.frames.length === 0) {
    throw new Error("Coach clip has no frames");
  }
  if (typeof raw.fps !== "number" || raw.fps <= 0) {
    throw new Error("Coach clip fps is invalid");
  }
  const frames = raw.frames.map((frame, index) => toSkeletonPose(frame, index));
  return {
    id: raw.id,
    name: raw.name,
    fps: raw.fps,
    durationSeconds: raw.durationSeconds,
    frames,
    motion: raw.motion,
    capturedAt: raw.capturedAt,
    thumbnails: Array.isArray(raw.thumbnails) ? raw.thumbnails : [],
  };
}

function toSkeletonPose(frame                          , index        )               {
  const out = {}                ;
  for (const name of JOINT_NAMES) {
    const raw = frame[name];
    if (!raw) {
      throw new Error(`Coach clip frame ${index} missing joint ${name}`);
    }
    const position             = [raw.position[0], raw.position[1], raw.position[2]];
    out[name] = {
      position,
      rotation: [raw.rotation[0], raw.rotation[1], raw.rotation[2], raw.rotation[3]],
    };
  }
  return out;
}
