





const PERSONA_SUFFIX                               = {
  biomech: "Persona：严谨的运动生物力学专家。引用一处具体肌肉或关节力学因果（如 \"臀中肌力量不足\"、\"髂腰肌过紧\"、\"足弓塌陷\"）。",
  baduanjin: "Persona：传统八段锦传人。引用\"势\"与\"经络\"（如\"调息不畅\"、\"足太阳膀胱经未通\"），但仍给出可量化训练建议。",
};

const SYSTEM_PROMPT_BASE = `你是 KINE//X 的运动复盘教练，针对用户刚完成的一段标准动作给出诊断。
输出规则（违反任一条视为失败）：
1. 仅输出诊断正文，120 字以内，单段，无标题、无序号、无 emoji、无 markdown。
2. 全句陈述肯定语气；禁止以"可能 / 或许 / 建议你"开头。
3. 提到关节误差必须带数字 + 单位 (° / 厘米 / %)。
4. 必须点名一处具体的生物力学因果或传统功理。
5. 最后一句给出一个可执行训练动作（一个动作 + 时长或次数）。
6. 全程中文，不夹英文。`;

export function buildDiagnosisMessages(
  exercise                ,
  session                ,
  persona              ,
)                {
  const payload = compactPayload(exercise, session);
  const system = `${SYSTEM_PROMPT_BASE}\n${PERSONA_SUFFIX[persona]}`;
  const user = `基于以下会话数据给出诊断：\n${JSON.stringify(payload)}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function buildFallbackText(exercise                , session                )         {
  const worst = session.joints[0];
  const avg = Math.round(session.avgScore);
  const phaseLabel = phaseToLabel(session.worstPhase);
  if (!worst) {
    return `本次 ${exercise.name} 综合匹配度 ${avg}%，未捕捉到显著偏差。维持当前节奏，继续巩固核心控制。下一组练习前完成 30 秒平板支撑作为预激活。`;
  }
  const delta = worst.worstAngleDeltaDeg.toFixed(1);
  const at = Math.round(worst.worstAtProgress * 100);
  return `本次 ${exercise.name} 综合匹配度 ${avg}%，${worst.name} 在动作 ${at}% 进度时偏差 ${delta}°，集中出现在${phaseLabel}阶段。这通常由相邻肌群激活不足造成。下一组练习前做 2 × 20 次靠墙静蹲 ${worst.id === "knee" || worst.id === "hip" ? "稳定膝髋" : "重建核心张力"}。`;
}























function compactPayload(exercise                , session                )                 {
  return {
    exercise: {
      id: exercise.id,
      name: exercise.name,
      discipline: exercise.discipline,
      motion: exercise.motion,
      durationSeconds: round2(exercise.durationSeconds),
    },
    session: {
      frames: session.frames,
      durationSeconds: round2(session.durationSeconds),
      avgScore: round1(session.avgScore),
      worstFrameScore: round1(session.worstFrameScore),
      worstPhase: session.worstPhase,
      phaseAvgScores: {
        intro: round1(session.phaseAvgScores.intro),
        mid: round1(session.phaseAvgScores.mid),
        peak: round1(session.phaseAvgScores.peak),
        outro: round1(session.phaseAvgScores.outro),
      },
    },
    joints: session.joints.slice(0, 5).map((j                  ) => ({
      id: j.id,
      name: j.name,
      avgScore: round1(j.avgScore),
      worstScore: round1(j.worstScore),
      worstAngleDeltaDeg: round1(j.worstAngleDeltaDeg),
      worstDistanceDeltaCm: round1(j.worstDistanceDeltaCm),
      worstAtProgress: round2(j.worstAtProgress),
      riskHits: j.riskHits,
    })),
  };
}

function phaseToLabel(phase        )         {
  switch (phase) {
    case "intro":
      return "起势";
    case "mid":
      return "下行";
    case "peak":
      return "底点";
    case "outro":
      return "收势";
    default:
      return "全段";
  }
}

function round1(v        )         {
  return Math.round(v * 10) / 10;
}

function round2(v        )         {
  return Math.round(v * 100) / 100;
}
